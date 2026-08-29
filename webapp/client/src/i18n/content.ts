/**
 * Arabic copy for the DEMO SEED DATA.
 *
 * The catalogue in en.ts/ar.ts covers the interface chrome. It cannot cover
 * rows that arrive from the API — farm names, task titles, ledger notes,
 * consultation threads — yet a stakeholder demo in Arabic must not show
 * English content. This maps each seeded English string to its Arabic
 * equivalent; `tc()` in i18n/index.tsx applies it and passes anything unknown
 * (including text the viewer typed) through untouched.
 *
 * Re-record the fixture and the seed text may change — add the new strings
 * here too. See docs/STATIC_DEMO_DEPLOYMENT.md.
 */
export const AR_CONTENT: Record<string, string> = {
  // ---- People ------------------------------------------------------------
  'Land Owner': 'مالك الأرض',
  'Field Moderator': 'مشرف الحقل',
  'Field Worker': 'عامل الحقل',
  'Hassan Ali': 'حسن علي',
  'Platform Admin': 'مدير المنصة',
  'Dr. Amina Farouk': 'د. أمينة فاروق',
  'Prof. Wei Chen': 'أ.د. وي تشن',

  // ---- Expert credentials ------------------------------------------------
  'Associate Professor': 'أستاذ مشارك',
  'Cairo University': 'جامعة القاهرة',
  Egypt: 'مصر',
  China: 'الصين',
  irrigation: 'الري',
  'soil salinity': 'ملوحة التربة',
  entomology: 'علم الحشرات',
  citrus: 'الموالح',

  // ---- Farms -------------------------------------------------------------
  'Demo Nile Delta Farm': 'مزرعة دلتا النيل التجريبية',
  'Fayoum Citrus Orchard': 'بستان موالح الفيوم',
  'Minya Desert Plot': 'قطعة المنيا الصحراوية',

  // ---- Task titles -------------------------------------------------------
  'Irrigation leak sector C': 'تسرب في شبكة الري — القطاع C',
  'Weed control north field': 'مكافحة الحشائش — الحقل الشمالي',
  'Citrus leaf-miner outbreak block 4': 'انتشار حفار أوراق الموالح — القطعة 4',
  'Replace clogged drip emitters row 7-9':
    'استبدال نقاطات الري المسدودة — الصفوف 7-9',
  'Windbreak netting torn — north edge':
    'تمزق شباك مصدات الرياح — الحافة الشمالية',
  'Soil salinity survey — plots A to D':
    'مسح ملوحة التربة — القطع من A إلى D',

  // ---- Task descriptions -------------------------------------------------
  'Main drip line leaking near valve C2; replace connector.':
    'تسرب في خط التنقيط الرئيسي قرب المحبس C2؛ يلزم استبدال الوصلة.',
  'Manual weeding rows 1–14; remove and compost biomass.':
    'إزالة الحشائش يدويًا في الصفوف 1–14، ثم جمع المخلفات وتحويلها إلى سماد.',
  'Silvery mines on young flush across ~40 trees; confirm species before spraying.':
    'أنفاق فضية على النموات الحديثة في نحو 40 شجرة؛ يجب تأكيد نوع الآفة قبل الرش.',
  'Emitters blocked by calcium scale; flush lines and swap 60 emitters.':
    'انسداد النقاطات بترسبات الكالسيوم؛ يلزم غسيل الخطوط واستبدال 60 نقاطًا.',
  'Sandstorm tore 30 m of netting; seedlings exposed.':
    'عاصفة رملية مزّقت 30 مترًا من الشباك وتركت الشتلات مكشوفة.',
  'Take EC readings at 0-30 cm and 30-60 cm on a 20 m grid.':
    'قياس التوصيل الكهربي على عمقي 0-30 سم و30-60 سم بشبكة كل 20 مترًا.',

  // ---- Issues ------------------------------------------------------------
  'Suspected leak — main line sector C':
    'اشتباه تسرب — الخط الرئيسي بالقطاع C',
  'Leaf-miner infestation — block 4': 'إصابة بحفار الأوراق — القطعة 4',
  'Emitter blockage — rows 7 to 9': 'انسداد النقاطات — الصفوف 7 إلى 9',
  'Windbreak netting torn after sandstorm':
    'تمزق شباك مصدات الرياح بعد عاصفة رملية',
  'Rising salinity in plots C and D': 'ارتفاع الملوحة في القطعتين C وD',
  'Salinity plan — Minya plot': 'خطة معالجة الملوحة — قطعة المنيا',
  'Calcium scale build-up in emitters.': 'تراكم ترسبات الكالسيوم داخل النقاطات.',
  'EC 6.1 dS/m at 30 cm in plot C.':
    'التوصيل الكهربي 6.1 ديسيسيمنز/م على عمق 30 سم في القطعة C.',

  // ---- Milestone and stage notes ----------------------------------------
  'Pressure normal, output low — blockage not a leak.':
    'الضغط طبيعي والتصريف منخفض — انسداد وليس تسربًا.',
  'Flow measured back at 4 L/h.': 'عاد التصريف إلى 4 لتر/ساعة.',
  'Flush done, emitters replaced.': 'تم الغسيل واستُبدلت النقاطات.',
  'Photographed 12 affected trees.': 'تم تصوير 12 شجرة مصابة.',
  'Phyllocnistis citrella confirmed from mine pattern.':
    'تأكيد الإصابة بحفار أوراق الموالح من شكل الأنفاق.',
  'Spray started block 4.': 'بدأ الرش في القطعة 4.',
  'Netting reattached but not tensioned; it will tear again. Redo with new posts.':
    'أُعيد تثبيت الشباك دون شدّ كافٍ وسيتمزق مجددًا؛ يجب إعادة التنفيذ بأعمدة جديدة.',
  'Flow restored to 4 L/h per emitter. Good work.':
    'عاد التصريف إلى 4 لتر/ساعة لكل نقاط. عمل جيد.',
  'Abamectin + horticultural oil on new flush only; consultation opened for resistance risk.':
    'أباميكتين مع زيت معدني على النموات الحديثة فقط، وفُتحت استشارة بشأن خطر المقاومة.',
  'Acid flush then replace the 60 worst emitters.':
    'غسيل حمضي ثم استبدال أسوأ 60 نقاطًا.',
  'Accepted. Add quarterly acid flush to the plan.':
    'تم القبول. يُضاف الغسيل الحمضي ربع السنوي إلى الخطة.',

  // ---- Finance ledger notes ---------------------------------------------
  'Tomato sale to market': 'بيع طماطم للسوق',
  'Weeding crew day rate': 'أجر يومي لفريق إزالة الحشائش',
  'Replacement drip line and couplings': 'خط تنقيط ووصلات بديلة',
  'Repair crew — half day': 'فريق إصلاح — نصف يوم',
  'Wheat seed batch': 'دفعة تقاوي قمح',
  'Windbreak posts and netting': 'أعمدة وشباك مصدات رياح',
  'Navel orange first pick': 'أول جنية برتقال أبو سرة',
  'Emitter flush and pressure test': 'غسيل النقاطات واختبار الضغط',
  'Foliar micronutrients — spring flush': 'رش عناصر صغرى — نموات الربيع',

  // ---- Comments ----------------------------------------------------------
  'Please double-check water pressure after the fix.':
    'من فضلك تأكد من ضغط المياه بعد الإصلاح.',

  // ---- Expert network ----------------------------------------------------
  'Leaf-miner rotation — Fayoum block 4':
    'تبديل المبيدات لحفار الأوراق — قطعة الفيوم 4',
  'Leaf-miner in Fayoum citrus block 4. Abamectin worked last season but pressure is back within three weeks. Is this resistance, and what rotation would you use on young flush?':
    'حفار أوراق الموالح في القطعة 4 بالفيوم. نجح الأباميكتين الموسم الماضي لكن الإصابة عادت خلال ثلاثة أسابيع. هل هذه مقاومة؟ وما برنامج التبديل الذي توصي به على النموات الحديثة؟',
  'Minya desert plot: EC climbing to 6 dS/m at 30 cm after two seasons of drip. Leaching fraction or gypsum first, and how do I avoid wasting water?':
    'قطعة المنيا الصحراوية: ارتفع التوصيل الكهربي إلى 6 ديسيسيمنز/م على عمق 30 سم بعد موسمين من الري بالتنقيط. هل أبدأ بنسبة الغسيل أم بالجبس؟ وكيف أتجنب إهدار المياه؟',
  'Three weeks of control is normal for abamectin under high pressure — that is degradation, not resistance. Confirm by checking whether mines stop at the treated flush. Rotate: abamectin + 0.5% oil on flush 1, spinetoram on flush 2, then a cyantraniliprole drench before flush 3. Never repeat the same IRAC group in one flush cycle, and stop spraying once the flush hardens off since the pest cannot mine mature leaves.':
    'ثلاثة أسابيع من السيطرة أمر معتاد للأباميكتين تحت ضغط إصابة عالٍ — هذا تحلل للمبيد وليس مقاومة. تأكد من ذلك بملاحظة ما إذا كانت الأنفاق تتوقف عند النموات المعاملة. اتبع التبديل الآتي: أباميكتين مع زيت 0.5% على النمو الأول، سبينتورام على النمو الثاني، ثم سقي بالسيانترانيليبرول قبل النمو الثالث. لا تكرر المجموعة نفسها من تصنيف IRAC في دورة نمو واحدة، وأوقف الرش بعد تصلب الأوراق لأن الآفة لا تستطيع اختراق الأوراق الناضجة.',
  'Before rotating chemistry, cut the trigger: synchronise irrigation and nitrogen so the block pushes flush in one window instead of continuously. A continuous flush gives the miner continuous host tissue and no spray programme will hold. Combine that with a single well-timed application at 20-30% flush emergence.':
    'قبل تبديل المبيدات، عالج السبب: وحّد مواعيد الري والتسميد النيتروجيني حتى تدفع القطعة نموًا واحدًا في نافذة محددة بدلًا من نمو مستمر. النمو المستمر يوفر للحفار عائلًا دائمًا ولن يصمد معه أي برنامج رش. اجمع ذلك مع رشة واحدة في التوقيت الصحيح عند ظهور 20-30% من النموات.',
  'Measure the irrigation water EC first — if it is above 2 dS/m the salt is arriving with every litre and gypsum will not help. Assuming sodic conditions (ESP > 15), apply gypsum at 2 t/ha banded under the emitters, then run a 15% leaching fraction on every third irrigation rather than a large periodic flush. Pulse irrigation keeps the wetting front moving down instead of evaporating at the surface, which is where your salt crust is forming.':
    'قِس أولًا التوصيل الكهربي لمياه الري — إذا تجاوز 2 ديسيسيمنز/م فالملح يصل مع كل لتر ولن يفيد الجبس. وبافتراض ظروف صودية (نسبة الصوديوم المتبادل أعلى من 15)، أضف الجبس بمعدل 2 طن/هكتار شريطًا أسفل النقاطات، ثم شغّل نسبة غسيل 15% مع كل رية ثالثة بدلًا من غسيل دوري كبير. الري النبضي يدفع جبهة البلل إلى أسفل بدلًا من تبخرها عند السطح حيث تتكون قشرة الملح لديك.',
  'Yes. Send readings at 0-30 and 30-60 cm two weeks after the third irrigation and I will tell you whether to extend the leaching fraction.':
    'نعم. أرسل القراءات على عمقي 0-30 و30-60 سم بعد أسبوعين من الرية الثالثة وسأخبرك إن كان يلزم زيادة نسبة الغسيل.',
  'Thanks — irrigation water tested at 1.4 dS/m, so it looks sodic rather than saline water.':
    'شكرًا — أظهر تحليل مياه الري 1.4 ديسيسيمنز/م، لذا تبدو المشكلة صودية لا ملوحة في المياه.',
  'Good, gypsum is the right first move then. Band it under the emitter line, not broadcast — you only need to reclaim the wetted bulb.':
    'جيد، إذن الجبس هو الخطوة الأولى الصحيحة. ضعه شريطًا أسفل خط النقاطات لا نثرًا — يكفي معالجة منطقة البلل.',
  'Understood. Can we review the EC readings again after the first leaching cycle?':
    'مفهوم. هل نراجع قراءات التوصيل الكهربي مرة أخرى بعد دورة الغسيل الأولى؟',

  // ---- Coded values the API returns verbatim -----------------------------
  water_leak: 'تسرب مياه',
  pest: 'آفة',
  equipment: 'معدات',
  general: 'عام',
  panel_cleaning: 'تنظيف الألواح',
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
  human_report: 'بلاغ بشري',
  sensor_rule: 'قاعدة مستشعر',
  ai_detection: 'كشف آلي',
};
