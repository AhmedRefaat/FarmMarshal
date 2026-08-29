/**
 * i18n/ar.ts — Arabic catalogue (DEFAULT LOCALE).
 * ---------------------------------------------------------------------------
 * Register: simplified Modern Standard Arabic, country-neutral so the same
 * wording reads correctly in Egypt and across the Gulf (ADR-026).
 * Terminology is NORMATIVE — it comes from docs/LOCALIZATION_SPEC.md §2.
 * Do not "improve" a term here without editing the glossary first.
 *
 * Notes for reviewers:
 *   • Plural records must cover zero/one/two/few/many/other — Arabic selects
 *     all six (3–10 → few, 11–99 → many).
 *   • The stage arrow is ← in Arabic: in an RTL line the logically-first item
 *     renders on the right, so a left-pointing arrow shows the correct flow.
 *   • Latin brand names (FarmMarshal, Google) stay Latin by design; the
 *     glossary bans transliteration, not proper nouns.
 */

import type { CatalogueValue } from './index';

export const ar = {
  // ---------------------------------------------------------------- app shell
  'app.name': 'FarmMarshal',
  'app.title': 'FarmMarshal — بوابة مالك المزرعة',
  'app.tagline': 'بوابة مالك المزرعة',

  'locale.toggle': 'English',
  'locale.toggleAria': 'تغيير اللغة',

  'nav.dashboard': 'لوحة المتابعة',
  'nav.farms': 'المزارع',
  'nav.tasks': 'المهام',
  'nav.myTasks': 'مهامي',
  'nav.evaluations': 'التقييمات',
  'nav.finance': 'المالية',
  'nav.experts': 'شبكة الخبراء',
  'nav.logout': 'تسجيل الخروج ({{name}})',
  'nav.workspace': 'مساحة عمل المالك',

  // Environment marker in the product bar, so a screenshot of the demo is
  // never mistaken for production data.
  'app.demoData': 'بيانات تجريبية',

  // ------------------------------------------------------------------ generic
  'common.loading': 'جارٍ التحميل…',
  'common.cancel': 'إلغاء',
  'common.send': 'إرسال',
  'common.submit': 'تأكيد',
  'common.add': 'إضافة',
  'common.none': '—',
  'common.all': 'الكل',
  'common.date': 'التاريخ',
  'common.name': 'الاسم',
  'common.role': 'الصفة',
  'common.status': 'الحالة',
  'common.title': 'العنوان',
  'common.note': 'ملاحظة',
  'common.amount': 'المبلغ',
  'common.type': 'النوع',
  'common.category': 'البند',
  'common.created': 'تاريخ الإنشاء',

  // -------------------------------------------------------------------- roles
  'role.owner': 'مالك المزرعة',
  'role.moderator': 'مشرف',
  'role.worker': 'عامل',
  'role.admin': 'مسؤول النظام',
  'role.accountant': 'محاسب',
  'role.agri_expert': 'خبير المزرعة',
  'role.crowd_expert': 'خبير الشبكة',
  'role.academic_expert': 'خبير أكاديمي',
  'role.learner': 'متدرّب',

  // ------------------------------------------------------------ task statuses
  'status.all': 'الكل',
  'status.assigned': 'مُسندة',
  'status.in_progress': 'جارٍ التنفيذ',
  'status.submitted': 'بانتظار المراجعة',
  'status.approved': 'معتمدة',
  'status.rejected': 'مرفوضة',

  // ------------------------------------------------------------- issue stages
  'stage.detected': 'تم الرصد',
  'stage.inspected': 'تمت المعاينة',
  'stage.identified': 'تم التشخيص',
  'stage.recommended': 'تمت التوصية',
  'stage.implemented': 'تم التنفيذ',
  'stage.reviewed': 'تمت المراجعة',
  'stage.closed': 'مغلقة',

  // -------------------------------------------------------------------- login
  'login.email': 'البريد الإلكتروني',
  'login.password': 'كلمة المرور',
  'login.signIn': 'تسجيل الدخول',
  'login.signingIn': 'جارٍ تسجيل الدخول…',
  'login.google': 'المتابعة عبر Google',
  'login.demoHint':
    'حسابات تجريبية: owner@ أو moderator@ أو worker@agri.com — كلمة المرور pass123',
  'login.failed': 'تعذّر تسجيل الدخول. تأكد من البريد الإلكتروني وكلمة المرور.',
  'login.googleFailed': 'تعذّر تسجيل الدخول عبر Google.',

  // ---------------------------------------------------------------- dashboard
  'dashboard.title': 'نظرة عامة على المزرعة',
  'dashboard.problems': 'مشكلات مفتوحة',
  'dashboard.activities': 'أعمال جارية',
  'dashboard.solutions': 'حلول منفَّذة',
  'dashboard.latestActivity': 'أحدث الأعمال',
  'dashboard.noActivity': 'لا توجد أعمال بعد.',
  'dashboard.teamQuality': 'مستوى الفريق',

  // ---------------------------------------------------------------- task list
  'tasks.title': 'المهام',
  'tasks.empty': 'لا توجد مهام مطابقة لهذه التصفية.',

  // -------------------------------------------------------------- task detail
  'task.openReport': 'عرض التقرير الكامل للمهمة',
  'task.location': 'الموقع: {{lat}}, {{lng}}',
  'task.reviewNote': 'ملاحظة المراجعة: {{note}}',
  'task.before': 'قبل التنفيذ',
  'task.after': 'بعد التنفيذ',
  'task.approve': 'اعتماد',
  'task.reject': 'رفض',
  'task.rejectPrompt': 'ما سبب رفض هذا العمل؟',
  'task.discussion': {
    zero: 'المناقشة (لا توجد رسائل)',
    one: 'المناقشة (رسالة واحدة)',
    two: 'المناقشة (رسالتان)',
    few: 'المناقشة ({{count}} رسائل)',
    many: 'المناقشة ({{count}} رسالة)',
    other: 'المناقشة ({{count}} رسالة)',
  } as CatalogueValue,
  'task.commentPlaceholder': 'اكتب تعليقًا…',
  'task.record': 'تسجيل رسالة صوتية',
  'task.stopSend': 'إيقاف وإرسال',

  // -------------------------------------------------------------------- farms
  'dashboard.subtitle': 'كل ما يجري في أرضك الآن، في مكان واحد.',
  'tasks.subtitle':
    'كل المهام على أرضك، من أول بلاغ حتى الإصلاح المؤكّد.',
  'finance.subtitle':
    'ما حققته كل مزرعة وما أنفقته، وإلى أين ذهبت الأموال.',
  'task.sampleEvidence': 'صور توضيحية — لم يُرفع دليل بعد',
  'farmDetail.heroCaption': 'أحدث مشهد جوي — صور تجريبية',
  'dashboard.eyebrow': 'مركز قيادة المالك',
  'tasks.eyebrow': 'العمليات الحقلية',
  'taskDetail.eyebrow': 'عملية حقلية قابلة للتتبع',
  'farmDetail.eyebrow': 'مساحة عمل المشروع',
  'evaluations.eyebrow': 'أداء الفريق',
  'finance.eyebrow': 'السجل المالي',
  'expert.eyebrow': 'مسار التوصيات المتوازي',
  'report.settlement': 'تكلفة الإجراء التصحيحي',
  'report.noCosts': 'لم تُسجّل أي مصروفات على هذه المهمة.',
  'report.costTotal': 'إجمالي المنصرف',
  'report.costNet': 'الأثر الصافي',
  'report.costCategory.seeds': 'بذور',
  'report.costCategory.fertilizer': 'أسمدة',
  'report.costCategory.labor': 'عمالة',
  'report.costCategory.fuel': 'وقود',
  'report.costCategory.equipment': 'معدات',
  'report.costCategory.harvest_sale': 'بيع محصول',
  'report.costCategory.other': 'أخرى',
  'report.eyebrow': 'سلسلة العهدة',
  'report.subtitle':
    'من قام بالإجراء، ومتى، وأين، وما الأدلة المرفقة، ومن قبِلَها.',
  'report.responsible': 'المسؤول: {{who}}',
  'report.lifecycle': 'مراحل المهمة',
  'farms.eyebrow': 'محفظة المالك',
  'farms.open': 'فتح المشروع ←',
  'farms.photoAlt': 'صورة جوية لـ {{name}}',
  'farms.title': 'مزارعي',
  'farms.subtitle': {
    zero: 'لا توجد مزارع تحت مسؤوليتك.',
    one: 'مزرعة واحدة تحت مسؤوليتك.',
    two: 'مزرعتان تحت مسؤوليتك.',
    few: '{{count}} مزارع تحت مسؤوليتك.',
    many: '{{count}} مزرعة تحت مسؤوليتك.',
    other: '{{count}} مزرعة تحت مسؤوليتك.',
  } as CatalogueValue,
  'farms.loading': 'جارٍ تحميل المزارع…',
  'farms.empty': 'لم تُسنَد إليك أي مزرعة بعد.',
  'farms.newIssues': 'مشكلات جديدة',
  'farms.activeIssues': 'مشكلات قيد المعالجة',
  'farms.solvedIssues': 'مشكلات تم حلها',
  'farms.new': 'جديدة',
  'farms.active': 'قيد المعالجة',
  'farms.solved': 'تم حلها',
  'farms.cardCounts': 'المهام: {{tasks}} · المشكلات: {{issues}}',

  // -------------------------------------------------------------- farm detail
  'farmDetail.loading': 'جارٍ تحميل بيانات المزرعة…',
  'farmDetail.allFarms': 'كل المزارع',
  'farmDetail.issues': 'المشكلات',
  'farmDetail.issueMeta': '{{kind}} · درجة الخطورة {{severity}}',
  'farmDetail.taskReport': 'تقرير المهمة',
  'farmDetail.nothingHere': 'لا يوجد شيء في هذا العمود.',
  'farmDetail.noTransitions': 'لم تُسجَّل أي انتقالات بعد.',
  'farmDetail.transition': '{{from}} ← {{to}}',
  'farmDetail.transitionBy': 'بواسطة {{role}} · {{when}}',
  'farmDetail.tasksOnFarm': 'مهام هذه المزرعة',
  'farmDetail.report': 'التقرير',
  'farmDetail.fullReport': 'التقرير الكامل',
  'farmDetail.noTasks': 'لا توجد مهام على هذه المزرعة.',
  'farmDetail.finance': 'الملخص المالي',
  'farmDetail.income': 'الإيرادات',
  'farmDetail.expense': 'المصروفات',
  'farmDetail.net': 'الصافي',

  // -------------------------------------------------------------- task report
  'report.loading': 'جارٍ تحميل التقرير…',
  'report.backToTask': 'العودة إلى المهمة',
  'report.unknownFarm': 'المزرعة غير محدّدة',
  'report.location': '{{farm}} · {{lat}}, {{lng}}',
  'report.people': 'الأشخاص',
  'report.reportedBy': 'أبلغ عنها',
  'report.assignedBy': 'أسندها (المشرف)',
  'report.executedBy': 'نفّذها (العامل)',
  'report.milestones': 'مراحل تنفيذ المهمة',
  'report.noMilestones': 'لم تُسجَّل أي مراحل.',
  'report.milestoneBy': '{{when}} · {{who}}',
  'report.milestone.created': 'الإبلاغ / الإنشاء',
  'report.milestone.started': 'بدء التنفيذ',
  'report.milestone.submitted': 'الإرسال للمراجعة',
  'report.milestone.reviewed': 'المراجعة',
  'report.issue': 'المشكلة الأصلية',
  'report.issueMeta':
    '{{kind}} · درجة الخطورة {{severity}} · مصدر البلاغ {{source}}',
  'report.noTransitions': 'لا توجد انتقالات بين المراحل بعد.',
  'report.solvedOn': 'تم الحل بتاريخ {{when}}.',
  'report.verdict': 'قرار المراجعة',
  'report.evidence': 'صور الإثبات',
  'report.conversation': {
    zero: 'المحادثة (لا توجد رسائل)',
    one: 'المحادثة (رسالة واحدة)',
    two: 'المحادثة (رسالتان)',
    few: 'المحادثة ({{count}} رسائل)',
    many: 'المحادثة ({{count}} رسالة)',
    other: 'المحادثة ({{count}} رسالة)',
  } as CatalogueValue,
  'report.noComments': 'لا توجد تعليقات.',

  // -------------------------------------------------------------- evaluations
  'evaluations.title': 'التقييمات',
  'evaluations.subtitleOwner': 'قيِّم المشرفين والعمال.',
  'evaluations.subtitleModerator': 'قيِّم العمال.',
  'evaluations.average': 'المتوسط',
  'evaluations.ratings': 'عدد التقييمات',
  'evaluations.rate': 'تقييم',
  'evaluations.rateTitle': 'تقييم {{name}}',
  'evaluations.commentPlaceholder': 'تعليق (اختياري)…',
  'evaluations.empty': 'لا يوجد أشخاص يمكنك تقييمهم.',

  // ------------------------------------------------------------------ finance
  'finance.title': 'المالية',
  'finance.allFarms': 'كل المزارع',
  'finance.expenses': 'المصروفات',
  'finance.income': 'الإيرادات',
  'finance.net': 'الصافي',
  'finance.typeExpense': 'مصروف',
  'finance.typeIncome': 'إيراد',
  'finance.amountPlaceholder': 'المبلغ',
  'finance.notePlaceholder': 'ملاحظة',
  'finance.out': 'صادر',
  'finance.in': 'وارد',
  'finance.category.seeds': 'بذور',
  'finance.category.fertilizer': 'أسمدة',
  'finance.category.labor': 'أجور العمالة',
  'finance.category.fuel': 'وقود',
  'finance.category.equipment': 'معدات',
  'finance.category.harvest_sale': 'بيع المحصول',
  'finance.category.other': 'أخرى',

  // ----------------------------------------------------------- expert network
  'consult.status.escrow': 'المكافأة محجوزة',
  'consult.status.open': 'مفتوحة',
  'consult.status.finalists': 'قائمة مختصرة',
  'consult.status.chosen': 'تم اعتماد توصية',
  'consult.status.settled': 'تمت التسوية',
  'consult.status.disputed': 'محل نزاع',
  'payout.status.held': 'محجوز لدى المنصة',
  'payout.status.released': 'تم الإفراج عنه',
  'payout.status.paid': 'تم الصرف',
  'expert.title': 'شبكة الخبراء الزراعيين',
  'expert.subtitle': {
    zero: 'لا يوجد خبراء موثّقون في الشبكة بعد.',
    one: 'خبير واحد موثَّق في الشبكة.',
    two: 'خبيران موثَّقان في الشبكة.',
    few: '{{count}} خبراء موثَّقين في الشبكة.',
    many: '{{count}} خبيرًا موثَّقًا في الشبكة.',
    other: '{{count}} خبير موثَّق في الشبكة.',
  } as CatalogueValue,
  'expert.subtitleRegistered': 'أنت مسجَّل كخبير في الشبكة.',
  'expert.casePool': 'الحالات المطروحة',
  'expert.poolEmpty': 'لا توجد حالات مطروحة حاليًا.',
  'expert.caseMeta': 'مكافأة {{bounty}} · طرحها {{requester}}',
  'expert.recommendationCount': {
    zero: 'لا توجد توصيات',
    one: 'توصية واحدة',
    two: 'توصيتان',
    few: '{{count}} توصيات',
    many: '{{count}} توصية',
    other: '{{count}} توصية',
  } as CatalogueValue,
  'expert.yours': 'حالتك',
  'expert.youAnswered': 'شاركت بتوصية',
  'expert.ask': 'اطرح حالتك على الشبكة',
  'expert.questionPlaceholder': 'اشرح الحالة للخبراء…',
  'expert.bountyPlaceholder': 'قيمة المكافأة (بالجنيه)',
  'expert.postCase': 'نشر الحالة',
  'expert.selectCase': 'اختر حالة لعرض التوصيات الخاصة بها.',
  'expert.case': 'الحالة',
  'expert.caseTerms':
    'المكافأة {{bounty}} · عمولة المنصة {{pct}}% · طرحها {{requester}}',
  'expert.recommendations': 'التوصيات ({{count}})',
  'expert.noRecommendations': 'لا توجد توصيات بعد.',
  'expert.chosen': 'التوصية المعتمدة',
  'expert.stars': 'التقييم {{stars}}',
  'expert.institution': 'الجهة: {{name}}',
  'expert.country': 'الدولة: {{name}}',
  'expert.specializations': 'التخصصات: {{list}}',
  'expert.answers': {
    zero: 'لا توجد إجابات',
    one: 'إجابة واحدة',
    two: 'إجابتان',
    few: '{{count}} إجابات',
    many: '{{count}} إجابة',
    other: '{{count}} إجابة',
  } as CatalogueValue,
  'expert.years': {
    zero: 'بلا خبرة مسجَّلة',
    one: 'سنة خبرة واحدة',
    two: 'سنتا خبرة',
    few: '{{count}} سنوات خبرة',
    many: '{{count}} سنة خبرة',
    other: '{{count}} سنة خبرة',
  } as CatalogueValue,
  'expert.payout': 'صافي المستحق {{net}} · عمولة {{commission}} · {{status}}',
  'expert.chooseRelease': 'اعتماد التوصية وصرف المكافأة',
  'expert.addRecommendation': 'أضف توصيتك',
  'expert.answerPlaceholder': 'تشخيصك والعلاج الموصى به…',
  'expert.submitRecommendation': 'إرسال التوصية',
  'expert.groupThread': 'مناقشة الحالة (جميع المشاركين)',
  'expert.privateThread': 'محادثة خاصة مع {{name}}',
  'expert.messagePlaceholder': 'اكتب رسالة…',
  'expert.noMessages': 'لا توجد رسائل بعد.',

  // ------------------------------------------------------------------- errors
  'error.generic': 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
  'error.401': 'انتهت جلستك. يُرجى تسجيل الدخول من جديد.',
  'error.402': 'هذه الميزة تتطلب ترقية الباقة.',
  'error.403': 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  'error.404': 'العنصر المطلوب غير موجود.',
  'error.409': 'هذا الإجراء يتعارض مع الحالة الحالية.',
  'error.500': 'الخدمة غير متاحة حاليًا. يُرجى المحاولة لاحقًا.',
} as const;
