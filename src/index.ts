import * as core from '@actions/core'
import * as github from '@actions/github'
import * as util from './util'
import { getInputs } from './inputs'

async function run() {
  try {
    const { context } = github

    core.debug(`event: ${context.eventName}`)
    core.debug(`action: ${context.payload.action}`)

    const pr = context.payload.pull_request
    const issue = context.payload.issue
    const payload = pr || issue
    const actions = ['opened', 'edited', 'labeled', 'unlabeled']
    if (
      payload &&
      (util.isValidEvent('issues', actions) ||
        util.isValidEvent('pull_request', actions) ||
        util.isValidEvent('pull_request_target', actions))
    ) {
      const inputs = getInputs()
      core.debug(`inputs: \n${JSON.stringify(inputs, null, 2)}`)
      if (pr) {
        core.debug(`pr: \n${JSON.stringify(pr, null, 2)}`)
      }
      if (issue) {
        core.debug(`issue: \n${JSON.stringify(issue, null, 2)}`)
      }

      if (pr && pr.draft && inputs.skipDraft !== false) {
        core.debug('pr is draft. Stopping execution.')
        return util.skip('is draft')
      }

      if (
        inputs.skipKeywords &&
        util.hasSkipKeywords(payload.title, inputs.skipKeywords)
      ) {
        core.debug('title includes skip-keywords. Stopping execution.')
        return util.skip('title includes skip-keywords')
      }

      core.debug('retrieving octokit object')
      const octokit = util.getOctokit()

      core.debug('checking for any includeLabels or excludeLabels')
      const checkIncludings =
        inputs.includeLabels && inputs.includeLabels.length > 0
      const checkExcludings =
        inputs.excludeLabels && inputs.excludeLabels.length > 0
      if (checkIncludings || checkExcludings) {
        const labels = await util.getIssueLabels(octokit, payload.number)
        const hasAny = (arr: string[]) => labels.some((l) => arr.includes(l))

        if (checkIncludings) {
          const any = hasAny(inputs.includeLabels)
          if (!any) {
            core.debug(
              'is not labeled with any of the "includeLabels". Stopping execution.',
            )
            return util.skip(`is not labeled with any of the "includeLabels"`)
          }
        }

        if (checkExcludings) {
          const any = hasAny(inputs.excludeLabels)
          if (any) {
            core.debug(
              'is labeled with one of the "excludeLabels". Stopping execution.',
            )
            return util.skip(`is labeled with one of the "excludeLabels"`)
          }
        }
      }

      core.debug('checking for any existing assignees, teams or reviewers')
      const { assignees, teams, reviewers } = await util.getState(octokit)
      core.debug(`assignees: \n${JSON.stringify(assignees, null, 2)}`)
      core.debug(`teams: \n${JSON.stringify(teams, null, 2)}`)
      core.debug(`reviewers: \n${JSON.stringify(reviewers, null, 2)}`)
      if (teams.length || reviewers.length) {
        const s = (len: number) => (len > 1 ? 's' : '')
        const logTeams = `team_reviewer${s(teams.length)} "${teams.join(', ')}"`
        const logReviewers = `reviewer${s(reviewers.length)} "${reviewers.join(
          ', ',
        )}"`

        if (teams.length && reviewers.length) {
          util.skip(`has requested ${logReviewers} and ${logTeams}`)
        } else if (teams.length) {
          util.skip(`has requested ${logTeams}`)
        } else {
          util.skip(`has requested ${logReviewers}`)
        }
      } else {
        core.debug(`adding reviewers from inputs`)
        await util.addReviewers(octokit, inputs)
      }

      if (assignees.length) {
        util.skip(`has assigned to ${assignees.join(', ')}`)
      } else {
        core.debug(`adding assignees from inputs`)
        await util.addAssignees(octokit, inputs)
      }
    }
  } catch (e) {
    core.debug(`An error has occurred: ${e.message}`)
    core.error(e)
    core.setFailed(e.message)
  }
}

run()
