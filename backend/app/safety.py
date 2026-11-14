"""Plain-language fallback explanations (English, Urdu, Roman Urdu) and safety validation of LLM output."""
from __future__ import annotations

import re

SUPPORTED_LANGS = ("en", "ur", "ro-ur")

DISCLAIMERS = {
    "en": (
        "This is not a diagnosis. Only a licensed doctor can diagnose conditions. "
        "Please discuss these results with your doctor."
    ),
    "ur": (
        "یہ بیماری کی تشخیص نہیں ہے۔ صرف ایک مستند ڈاکٹر ہی تشخیص کر سکتا ہے۔ "
        "براہِ کرم ان نتائج پر اپنے ڈاکٹر سے مشورہ کریں۔"
    ),
    "ro-ur": (
        "Yeh kisi beemari ki tashkhees (diagnosis) nahi hai. Sirf aik licensed doctor hi "
        "tashkhees kar sakta hai. Baraye meharbani in nataij par apne doctor se mashwara karein."
    ),
}

TEST_INFO = {
    "en": {
        "hemoglobin": "Hemoglobin is the part of red blood cells that carries oxygen around your body.",
        "white blood cell count": "White blood cells are the body's defenders that help fight germs.",
        "platelet count": "Platelets are tiny blood cells that help your blood clot and stop bleeding.",
        "fasting blood sugar": "Fasting blood sugar is the amount of sugar (glucose) in your blood after not eating for several hours.",
        "alt": "ALT is a substance made mostly in the liver; its level gives clues about how the liver is doing.",
        "ast": "AST is a substance found in the liver and muscles; its level gives clues about the liver and muscles.",
        "cholesterol": "Cholesterol is a fatty substance in the blood; the body needs some, but too much can affect blood vessels.",
        "tsh": "TSH is a signal from the brain that tells the thyroid gland (in your neck) how hard to work.",
        "urine ph": "Urine pH shows how acidic or basic your urine is.",
        "urine protein": "Urine protein checks whether protein is leaking into your urine; normally there is none.",
    },
    "ur": {
        "hemoglobin": "ہیموگلوبن خون کے سرخ خلیات کا وہ حصہ ہے جو پورے جسم میں آکسیجن پہنچاتا ہے۔",
        "white blood cell count": "سفید خلیات (WBC) جسم کے محافظ ہیں جو جراثیم سے لڑنے میں مدد دیتے ہیں۔",
        "platelet count": "پلیٹلیٹس خون کے چھوٹے خلیات ہیں جو خون جمنے اور بہنے سے روکنے میں مدد کرتے ہیں۔",
        "fasting blood sugar": "فاسٹنگ بلڈ شوگر کھانا نہ کھانے کے بعد خون میں شوگر (گلوکوز) کی مقدار بتاتی ہے۔",
        "alt": "ALT ایک مادہ ہے جو زیادہ تر جگر میں بنتا ہے؛ اس سے جگر کی کارکردگی کا اندازہ ہوتا ہے۔",
        "ast": "AST جگر اور پٹھوں میں پایا جانے والا مادہ ہے جو ان کی صحت کے بارے میں اشارہ دیتا ہے۔",
        "cholesterol": "کولیسٹرول خون میں چکنائی کی ایک قسم ہے؛ اس کی زیادہ مقدار خون کی نالیوں کو متاثر کر سکتی ہے۔",
        "tsh": "TSH دماغ کا ایک سگنل ہے جو گردن میں موجود تھائیرائیڈ غدود کو کام کرنے کا بتاتا ہے۔",
        "urine ph": "یورین pH بتاتا ہے کہ پیشاب کتنا تیزابی یا اساسی ہے۔",
        "urine protein": "یورین پروٹین چیک کرتا ہے کہ پیشاب میں پروٹین تو نہیں آ رہا؛ عام طور پر یہ منفی ہوتا ہے۔",
    },
    "ro-ur": {
        "hemoglobin": "Hemoglobin khoon ke surkh khaliyat (red blood cells) ka woh hissa hai jo poore jism mein oxygen pohanchata hai.",
        "white blood cell count": "White blood cells (WBC) jism ke muhafiz hain jo jaraseem aur infection se larnay mein madad karte hain.",
        "platelet count": "Platelets khoon ke chhotay khaliyat hain jo khoon jamnay aur bleeding roknay mein madad dete hain.",
        "fasting blood sugar": "Fasting blood sugar khaana na khaane ke baad aap ke khoon mein sugar (glucose) ki miqdaar batati hai.",
        "alt": "ALT aik enzyme hai jo zyada tar jigar (liver) mein banta hai; is se jigar ki sehat ka andaza hota hai.",
        "ast": "AST jigar aur pathon (muscles) mein paya jane wala mada hai jo un ki karkardagi ka ishara deta hai.",
        "cholesterol": "Cholesterol khoon mein chiknai (fat) ki aik qisam hai; zaroorat se zyada miqdaar khoon ki naliyon par asar daal sakti hai.",
        "tsh": "TSH dimagh ka aik signal hai jo gardan mein maujood thyroid gland ko batata hai ke kitna kaam karna hai.",
        "urine ph": "Urine pH batata hai ke aap ka peshab kitna tezabi (acidic) ya basic hai.",
        "urine protein": "Urine protein check karta hai ke peshab mein protein leak to nahi ho raha; aam tor par yeh Negative hota hai.",
    },
}

STATUS_TEXT = {
    "en": {
        "normal": "Your result is within the normal range.",
        "low": "Your result is lower than the normal range. A low value can have many causes, some harmless; your doctor can explain what it means for you.",
        "high": "Your result is higher than the normal range. A high value can have many causes, some harmless; your doctor can explain what it means for you.",
        "urgent": "Your result has reached a level the lab marks as critical. Please see a doctor today.",
        "cannot_classify": "The lab's reference files do not have a range for this test or unit, so it cannot be classified from the files.",
        "needs_demographics": "The right normal range depends on age and sex, which are missing, so this result cannot be classified yet.",
    },
    "ur": {
        "normal": "آپ کا نتیجہ نارمل رینج کے اندر ہے۔",
        "low": "آپ کا نتیجہ نارمل رینج سے کم ہے۔ اس کی کئی وجوہات ہو سکتی ہیں؛ آپ کا ڈاکٹر بتا سکتا ہے کہ اس کا آپ کے لیے کیا مطلب ہے۔",
        "high": "آپ کا نتیجہ نارمل رینج سے زیادہ ہے۔ اس کی کئی وجوہات ہو سکتی ہیں؛ آپ کا ڈاکٹر بتا سکتا ہے کہ اس کا آپ کے لیے کیا مطلب ہے۔",
        "urgent": "آپ کا نتیجہ خطرے کی حد تک پہنچ گیا ہے۔ براہِ کرم آج ہی ڈاکٹر سے رجوع کریں۔",
        "cannot_classify": "لیب کی فائلوں میں اس ٹیسٹ یا یونٹ کی نارمل رینج موجود نہیں ہے، اس لیے فائلوں سے اس کی درجہ بندی نہیں کی جا سکتی۔",
        "needs_demographics": "درست نارمل رینج کا انحصار عمر اور جنس پر ہے جو رپورٹ میں موجود نہیں، اس لیے ابھی درجہ بندی نہیں ہو سکتی۔",
    },
    "ro-ur": {
        "normal": "Aap ka result normal range ke andar hai.",
        "low": "Aap ka result normal range se kam (low) hai. Is ki kai wajohat ho sakti hain; aap ka doctor bata sakta hai ke aap ke liye is ka kya matlab hai.",
        "high": "Aap ka result normal range se zyada (high) hai. Is ki kai wajohat ho sakti hain; aap ka doctor bata sakta hai ke aap ke liye is ka kya matlab hai.",
        "urgent": "Aap ka result lab ki critical (khatarnaak) had tak pohanch gaya hai. Baraye meharbani aaj hi doctor ko dikhayein.",
        "cannot_classify": "Lab ki reference files mein is test ya unit ki normal range maujood nahi hai, is liye files se isay classify nahi kiya ja sakta.",
        "needs_demographics": "Sahi normal range umar (age) aur jins (sex) par depend karti hai jo missing hai, is liye abhi classify nahi ho sakta.",
    },
}

_DIAGNOSIS_PATTERNS = [
    r"\byou (?:have|has|are suffering from|suffer from|are diagnosed)\b(?! (?:a|an|the)? ?(?:normal|high|low|result|value|reading|level|question))",
    r"\b(?:diagnos(?:is|ed) (?:of|with))\b",
    r"\byou are (?:diabetic|anemic|anaemic)\b",
    r"\bthis (?:means|confirms|shows) (?:you|that you) (?:have|are)\b",
    r"\bconfirms? (?:a |an )?(?:disease|diagnosis|condition)\b",
]
_DIAG_RE = re.compile("|".join(_DIAGNOSIS_PATTERNS), re.I)


def norm_lang(lang: str | None) -> str:
    if not lang:
        return "en"
    l = lang.strip().lower()
    return l if l in SUPPORTED_LANGS else "en"


def get_disclaimer(lang: str = "en") -> str:
    return DISCLAIMERS.get(norm_lang(lang), DISCLAIMERS["en"])


def looks_like_diagnosis(text: str) -> bool:
    return bool(_DIAG_RE.search(text or ""))


def template_explanation(result: dict, lang: str = "en") -> str:
    lang = norm_lang(lang)
    info = TEST_INFO[lang].get(result.get("test_key") or "", "")
    status = STATUS_TEXT[lang].get(result["status"], "")
    return f"{info} {status}".strip()


def template_questions(results: list[dict], lang: str = "en") -> list[str]:
    lang = norm_lang(lang)
    order = {"urgent": 0, "high": 1, "low": 1, "needs_demographics": 2, "cannot_classify": 3}
    flagged = sorted((r for r in results if r["status"] in order), key=lambda r: order[r["status"]])
    qs: list[str] = []
    for r in flagged:
        val = f"{r['value']} {r['unit']}".strip()
        if lang == "ur":
            if r["status"] == "urgent":
                qs.append(f"میرا {r['test']} کا نتیجہ {val} آیا ہے جسے لیب نے انتہائی تشویشناک قرار دیا ہے۔ مجھے آج کیا کرنا چاہیے؟")
            elif r["status"] in ("high", "low"):
                qs.append(f"میرا {r['test']} نارمل سے ہٹ کر ({val}) آیا ہے۔ اس کی کیا وجہ ہو سکتی ہے اور کیا مزید ٹیسٹ درکار ہیں؟")
            elif r["status"] == "cannot_classify":
                qs.append(f"لیب فائلوں سے میرے {r['test']} ({val}) کی درجہ بندی نہیں ہو سکی۔ میرے لیے اس کا کیا مطلب ہے؟")
            else:
                qs.append(f"میری عمر اور جنس کے مطابق میرے {r['test']} کے لیے کون سی نارمل رینج لاگو ہوتی ہے؟")
        elif lang == "ro-ur":
            if r["status"] == "urgent":
                qs.append(f"Mera {r['test']} {val} aaya hai jisay lab ne critical mark kiya hai. Mujhe aaj foran kya karna chahiye?")
            elif r["status"] in ("high", "low"):
                qs.append(f"Mera {r['test']} {r['status']} ({val}) aaya hai. Is ki kya wajah ho sakti hai aur kya mazeed test zaroori hain?")
            elif r["status"] == "cannot_classify":
                qs.append(f"Lab files se mere {r['test']} ({val}) ko classify nahi kiya ja saka. Mere liye is ka kya matlab hai?")
            else:
                qs.append(f"Meri umar aur jins ke mutabiq {r['test']} ki sahi normal range kya hai?")
        else:
            if r["status"] == "urgent":
                qs.append(f"My {r['test']} was {val}, which the lab marks as critical. What should I do today?")
            elif r["status"] in ("high", "low"):
                qs.append(f"My {r['test']} was {r['status']} ({val}). What could cause this, and do I need more tests?")
            elif r["status"] == "cannot_classify":
                qs.append(f"The lab could not classify my {r['test']} result ({val}). What does it mean for me?")
            else:
                qs.append(f"Which normal range applies to my {r['test']} result given my age and sex?")
    generic_map = {
        "en": [
            "Do any of these results need a repeat test or follow-up?",
            "Is there anything in my diet, medicines or lifestyle that could affect these results?",
            "When should I get these tests checked again?",
        ],
        "ur": [
            "کیا ان نتائج میں سے کسی کے لیے دوبارہ ٹیسٹ یا فالو اپ کی ضرورت ہے؟",
            "کیا میری خوراک، ادویات یا طرزِ زندگی ان نتائج کو متاثر کر سکتے ہیں؟",
            "مجھے یہ ٹیسٹ دوبارہ کب کروانے چاہئیں؟",
        ],
        "ro-ur": [
            "Kya in results mein se kisi ke liye repeat test ya follow-up ki zaroorat hai?",
            "Kya meri khorak (diet), dawaiyan ya lifestyle in results par asar daal sakte hain?",
            "Mujhe yeh tests dobara kab check karwane chahiyein?",
        ],
    }
    for g in generic_map[lang]:
        if len(qs) >= 3:
            break
        qs.append(g)
    return qs[:5]


def clean_questions(qs: object, results: list[dict], lang: str = "en") -> list[str]:
    if not isinstance(qs, list):
        return template_questions(results, lang)
    out = [q.strip() for q in qs if isinstance(q, str) and q.strip() and not looks_like_diagnosis(q)]
    if len(out) < 3:
        for q in template_questions(results, lang):
            if len(out) >= 3:
                break
            if q not in out:
                out.append(q)
    return out[:5]
