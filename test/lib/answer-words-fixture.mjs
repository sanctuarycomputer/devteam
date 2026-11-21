// What answer-words.*.test.mjs share. An answer is the option picked plus the words typed (kit-313):
// answer --choice records the pick beside the words, answer --in-words records words alone, which
// approve nothing until the supervisor reads them (answer --read … --cite … --class …), and
// questionView checks any reading itself, never trusting a supervisor line that fails its checks.

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const RATE = ['--stake', '1', '--urgency', '1'];
const YN = JSON.stringify([{ label: 'Yes' }, { label: 'No' }]);
const firstId = (s) => s.split('\n')[0].trim();
// Distinct words for each question, so the kit's re-ask refusal never takes one for another.
const TEXTS = ['Should checkout move to the new pricing page before launch?', 'Do invoices go out on the first business day of each month?', 'Can refunds skip the manual review queue under fifty dollars?', 'Will the mobile app share the web login cookie?', 'Must exports include archived customers by default?', 'Is dark mode worth shipping ahead of the holiday freeze?', 'Should trial accounts keep their data after ninety days?', 'May the support team see partial card numbers?', 'Does the onboarding tour replay after every major release?', 'Could weekly digests replace the daily summary email?', 'Ought the status page show maintenance windows a week ahead?', 'Should failed webhooks retry for a full day?', 'Are team invitations limited to verified domains?', 'Would a yearly plan discount of twenty percent hurt margins?', 'Shall the legacy API stay up until spring?', 'Should search index deleted projects for thirty days?', 'Can admins impersonate users without a ticket?', 'Do we localise receipts into French and German first?', 'Is single sign-on included on the starter tier?', 'Should usage alerts fire at eighty percent of quota?', 'Do contractors get read access to the billing dashboard?', 'Should the changelog email go to every workspace admin?', 'Can a workspace hold more than one custom domain?', 'Will the free tier keep its API rate limit next year?', 'Should archived boards stay searchable for a year?', 'Do guests see the comment history on shared docs?', 'Can billing contacts change the plan without an admin?', 'Should the desktop app update itself overnight?', 'Do shared links expire after thirty days?', 'Should the API return totals in cents?'];

export { firstId, RATE, SUP, TEXTS, YN };
