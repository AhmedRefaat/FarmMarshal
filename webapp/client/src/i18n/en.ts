/**
 * i18n/en.ts — English catalogue. THIS FILE IS THE REFERENCE KEY SET.
 * ---------------------------------------------------------------------------
 * `ar.ts` must expose exactly these keys; a parity test fails the build on
 * drift, which is what keeps a newly added page from shipping half-translated.
 *
 * Conventions:
 *   • One key per SENTENCE. Never assemble a sentence from two keys.
 *   • `{{placeholder}}` for every runtime value.
 *   • A plural record `{ one, other, … }` whenever a count appears in the text.
 *   • KPI captions are noun phrases, not sentences, because the number is
 *     rendered as a separate visual element beside them.
 */

import type { CatalogueValue } from './index';

export const en = {
  // ---------------------------------------------------------------- app shell
  'app.name': 'FarmMarshal',
  'app.title': 'FarmMarshal — Land Owner Portal',
  'app.tagline': 'Land Owner Portal',

  'locale.toggle': 'العربية',
  'locale.toggleAria': 'Switch language',

  'nav.dashboard': 'Dashboard',
  'nav.farms': 'Farms',
  'nav.tasks': 'Tasks',
  'nav.myTasks': 'My tasks',
  'nav.evaluations': 'Evaluations',
  'nav.finance': 'Finance',
  'nav.experts': 'Expert network',
  'nav.logout': 'Log out ({{name}})',
  'nav.workspace': 'Owner workspace',

  // Environment marker in the product bar, so a screenshot of the demo is
  // never mistaken for production data.
  'app.demoData': 'Demo data',

  // ------------------------------------------------------------------ generic
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'common.send': 'Send',
  'common.submit': 'Submit',
  'common.add': 'Add',
  'common.none': '—',
  'common.all': 'All',
  'common.date': 'Date',
  'common.name': 'Name',
  'common.role': 'Role',
  'common.status': 'Status',
  'common.title': 'Title',
  'common.note': 'Note',
  'common.amount': 'Amount',
  'common.type': 'Type',
  'common.category': 'Category',
  'common.created': 'Created',

  // -------------------------------------------------------------------- roles
  'role.owner': 'Owner',
  'role.moderator': 'Field manager',
  'role.worker': 'Worker',
  'role.admin': 'System administrator',
  'role.accountant': 'Accountant',
  'role.agri_expert': 'Farm expert',
  'role.crowd_expert': 'Network expert',
  'role.academic_expert': 'Academic expert',
  'role.learner': 'Learner',

  // ------------------------------------------------------------ task statuses
  'status.all': 'All',
  'status.assigned': 'Assigned',
  'status.in_progress': 'In progress',
  'status.submitted': 'Awaiting review',
  'status.approved': 'Approved',
  'status.rejected': 'Rejected',

  // ----------------------------------------------------------- issue stages
  'stage.detected': 'Detected',
  'stage.inspected': 'Inspected',
  'stage.identified': 'Identified',
  'stage.recommended': 'Recommended',
  'stage.implemented': 'Implemented',
  'stage.reviewed': 'Reviewed',
  'stage.closed': 'Closed',

  // -------------------------------------------------------------------- login
  'login.email': 'Email',
  'login.password': 'Password',
  'login.signIn': 'Sign in',
  'login.signingIn': 'Signing in…',
  'login.google': 'Continue with Google',
  'login.demoHint': 'Demo: owner@ / moderator@ / worker@agri.com — pass123',
  'login.failed': 'Sign-in failed. Check your email and password.',
  'login.googleFailed': 'Google sign-in failed.',

  // ---------------------------------------------------------------- dashboard
  'dashboard.title': 'Land overview',
  'dashboard.problems': 'Open problems',
  'dashboard.activities': 'Ongoing activities',
  'dashboard.solutions': 'Completed solutions',
  'dashboard.latestActivity': 'Latest activity',
  'dashboard.noActivity': 'No activity yet.',
  'dashboard.teamQuality': 'Team quality',

  // ---------------------------------------------------------------- task list
  'tasks.title': 'Tasks',
  'tasks.empty': 'No tasks match this filter.',

  // -------------------------------------------------------------- task detail
  'task.openReport': 'Open the full task report',
  'task.location': 'Location: {{lat}}, {{lng}}',
  'task.reviewNote': 'Review note: {{note}}',
  'task.before': 'Before',
  'task.after': 'After',
  'task.approve': 'Approve',
  'task.reject': 'Reject',
  'task.rejectPrompt': 'Why is this work being rejected?',
  'task.discussion': {
    one: 'Discussion ({{count}} message)',
    other: 'Discussion ({{count}} messages)',
  } as CatalogueValue,
  'task.commentPlaceholder': 'Write a comment…',
  'task.record': 'Record a voice note',
  'task.stopSend': 'Stop and send',

  // -------------------------------------------------------------------- farms
  'dashboard.subtitle':
    'Everything happening across your land right now, in one place.',
  'tasks.subtitle':
    'Every assignment on your land, from first report to verified fix.',
  'finance.subtitle':
    'What each farm earned and spent, and where the money went.',
  'task.sampleEvidence': 'Sample imagery — no evidence uploaded yet',
  'farmDetail.heroCaption': 'Latest aerial overview — demo imagery',
  'dashboard.eyebrow': 'Owner command center',
  'tasks.eyebrow': 'Field operations',
  'taskDetail.eyebrow': 'Trackable field operation',
  'farmDetail.eyebrow': 'Project workspace',
  'evaluations.eyebrow': 'Team performance',
  'finance.eyebrow': 'Financial ledger',
  'expert.eyebrow': 'Parallel recommendation workflow',
  'report.settlement': 'Cost of the corrective action',
  'report.noCosts': 'No spend has been booked against this task.',
  'report.costTotal': 'Total spent',
  'report.costNet': 'Net effect',
  'report.costCategory.seeds': 'Seeds',
  'report.costCategory.fertilizer': 'Fertilizer',
  'report.costCategory.labor': 'Labour',
  'report.costCategory.fuel': 'Fuel',
  'report.costCategory.equipment': 'Equipment',
  'report.costCategory.harvest_sale': 'Harvest sale',
  'report.costCategory.other': 'Other',
  'report.eyebrow': 'Chain of custody',
  'report.subtitle':
    'Who acted, when, where, what evidence was attached and who accepted it.',
  'report.responsible': 'Responsible: {{who}}',
  'report.lifecycle': 'Task lifecycle',
  'farms.eyebrow': 'Owner portfolio',
  'farms.open': 'Open project →',
  'farms.photoAlt': 'Aerial view of {{name}}',
  'farms.title': 'My farms',
  'farms.subtitle': {
    one: '{{count}} farm under your responsibility.',
    other: '{{count}} farms under your responsibility.',
  } as CatalogueValue,
  'farms.loading': 'Loading the portfolio…',
  'farms.empty': 'No farms are assigned to you yet.',
  'farms.newIssues': 'New issues',
  'farms.activeIssues': 'Active issues',
  'farms.solvedIssues': 'Solved issues',
  'farms.new': 'New',
  'farms.active': 'Active',
  'farms.solved': 'Solved',
  'farms.cardCounts': 'Tasks: {{tasks}} · Issues: {{issues}}',

  // ------------------------------------------------------------- farm detail
  'farmDetail.loading': 'Loading the farm…',
  'farmDetail.allFarms': 'All farms',
  'farmDetail.issues': 'Issues',
  'farmDetail.issueMeta': '{{kind}} · severity {{severity}}',
  'farmDetail.taskReport': 'Task report',
  'farmDetail.nothingHere': 'Nothing in this column.',
  'farmDetail.noTransitions': 'No transitions recorded yet.',
  'farmDetail.transition': '{{from}} → {{to}}',
  'farmDetail.transitionBy': 'by {{role}} · {{when}}',
  'farmDetail.tasksOnFarm': 'Tasks on this farm',
  'farmDetail.report': 'Report',
  'farmDetail.fullReport': 'Full report',
  'farmDetail.noTasks': 'No tasks on this farm.',
  'farmDetail.finance': 'Finance',
  'farmDetail.income': 'Income',
  'farmDetail.expense': 'Expenses',
  'farmDetail.net': 'Net',

  // ------------------------------------------------------------- task report
  'report.loading': 'Loading the report…',
  'report.backToTask': 'Back to the task',
  'report.unknownFarm': 'Farm not identified',
  'report.location': '{{farm}} · {{lat}}, {{lng}}',
  'report.people': 'People',
  'report.reportedBy': 'Reported by',
  'report.assignedBy': 'Assigned by (field manager)',
  'report.executedBy': 'Executed by (worker)',
  'report.milestones': 'Task milestones',
  'report.noMilestones': 'No milestones recorded.',
  'report.milestoneBy': '{{when}} · {{who}}',
  'report.milestone.created': 'Reported / created',
  'report.milestone.started': 'Work started',
  'report.milestone.submitted': 'Submitted for review',
  'report.milestone.reviewed': 'Reviewed',
  'report.issue': 'Originating issue',
  'report.issueMeta': '{{kind}} · severity {{severity}} · reported via {{source}}',
  'report.noTransitions': 'No stage transitions yet.',
  'report.solvedOn': 'Solved on {{when}}.',
  'report.verdict': 'Review verdict',
  'report.evidence': 'Evidence',
  'report.conversation': {
    one: 'Conversation ({{count}} message)',
    other: 'Conversation ({{count}} messages)',
  } as CatalogueValue,
  'report.noComments': 'No comments.',

  // -------------------------------------------------------------- evaluations
  'evaluations.title': 'Evaluations',
  'evaluations.subtitleOwner': 'Rate your field managers and workers.',
  'evaluations.subtitleModerator': 'Rate your workers.',
  'evaluations.average': 'Average',
  'evaluations.ratings': 'Ratings',
  'evaluations.rate': 'Rate',
  'evaluations.rateTitle': 'Rate {{name}}',
  'evaluations.commentPlaceholder': 'Comment (optional)…',
  'evaluations.empty': 'There is nobody for you to rate.',

  // ------------------------------------------------------------------ finance
  'finance.title': 'Finance',
  'finance.allFarms': 'All farms',
  'finance.expenses': 'Expenses',
  'finance.income': 'Income',
  'finance.net': 'Net',
  'finance.typeExpense': 'Expense',
  'finance.typeIncome': 'Income',
  'finance.amountPlaceholder': 'Amount',
  'finance.notePlaceholder': 'Note',
  'finance.out': 'Out',
  'finance.in': 'In',
  'finance.category.seeds': 'Seeds',
  'finance.category.fertilizer': 'Fertilizer',
  'finance.category.labor': 'Labour',
  'finance.category.fuel': 'Fuel',
  'finance.category.equipment': 'Equipment',
  'finance.category.harvest_sale': 'Harvest sale',
  'finance.category.other': 'Other',

  // ----------------------------------------------------------- expert network
  'consult.status.escrow': 'Bounty held',
  'consult.status.open': 'Open',
  'consult.status.finalists': 'Shortlisted',
  'consult.status.chosen': 'Recommendation chosen',
  'consult.status.settled': 'Settled',
  'consult.status.disputed': 'Disputed',
  'payout.status.held': 'Held by the platform',
  'payout.status.released': 'Released',
  'payout.status.paid': 'Paid',
  'expert.title': 'Agriculture expert network',
  'expert.subtitle': {
    one: '{{count}} verified expert on the network.',
    other: '{{count}} verified experts on the network.',
  } as CatalogueValue,
  'expert.subtitleRegistered': 'You are registered as an expert on the network.',
  'expert.casePool': 'Case pool',
  'expert.poolEmpty': 'The pool is empty.',
  'expert.caseMeta': '{{bounty}} bounty · asked by {{requester}}',
  'expert.recommendationCount': {
    zero: 'No recommendations',
    one: '{{count}} recommendation',
    other: '{{count}} recommendations',
  } as CatalogueValue,
  'expert.yours': 'Yours',
  'expert.youAnswered': 'You answered',
  'expert.ask': 'Ask the network',
  'expert.questionPlaceholder': 'Describe the case for the network…',
  'expert.bountyPlaceholder': 'Bounty (EGP)',
  'expert.postCase': 'Post the case',
  'expert.selectCase': 'Select a case to see its recommendations.',
  'expert.case': 'Case',
  'expert.caseTerms': 'Bounty {{bounty}} · platform commission {{pct}}% · asked by {{requester}}',
  'expert.recommendations': 'Recommendations ({{count}})',
  'expert.noRecommendations': 'No recommendations yet.',
  'expert.chosen': 'Chosen',
  'expert.stars': 'Rating {{stars}}',
  'expert.institution': 'Institution: {{name}}',
  'expert.country': 'Country: {{name}}',
  'expert.specializations': 'Specializations: {{list}}',
  'expert.answers': {
    zero: 'no answers',
    one: '{{count}} answer',
    other: '{{count}} answers',
  } as CatalogueValue,
  'expert.years': {
    one: '{{count}} year of experience',
    other: '{{count}} years of experience',
  } as CatalogueValue,
  'expert.payout': 'Net payout {{net}} · commission {{commission}} · {{status}}',
  'expert.chooseRelease': 'Choose and release the bounty',
  'expert.addRecommendation': 'Add your recommendation',
  'expert.answerPlaceholder': 'Your diagnosis and recommended treatment…',
  'expert.submitRecommendation': 'Submit the recommendation',
  'expert.groupThread': 'Case discussion (all responders)',
  'expert.privateThread': 'Private thread with {{name}}',
  'expert.messagePlaceholder': 'Write a message…',
  'expert.noMessages': 'No messages yet.',

  // ------------------------------------------------------------------- errors
  'error.generic': 'Something went wrong. Please try again.',
  'error.401': 'Your session has expired. Please sign in again.',
  'error.402': 'This feature requires a plan upgrade.',
  'error.403': 'You do not have permission to do this.',
  'error.404': 'The requested item was not found.',
  'error.409': 'This action conflicts with the current state.',
  'error.500': 'The service is unavailable right now. Please try again later.',
} as const;
