"use strict";

/*
 * Where the "Send feedback" button posts to. Paste the incoming-webhook address
 * of the Microsoft Teams channel (Workflows: "Post to a channel when a webhook
 * request is received"), Slack, Google Chat or Discord channel between the
 * quotes, reload the extension, and send the folder to the team.
 *
 * Leave it empty to have no shared channel: each person can still set one in
 * their own browser from the Feedback window. Anyone who has this address can
 * post to the channel, so share the extension only inside the team.
 */
globalThis.SXRTS = globalThis.SXRTS || {};
globalThis.SXRTS.feedbackConfig = {
  webhookUrl: ""
};
