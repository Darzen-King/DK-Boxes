// UI 中英切換。動態字串透過 window.t(key) 取用；靜態文字用 data-i18n 標記。

const TRANSLATIONS = {
  zh: {
    title: "🌸 BINI Blooms 宣傳影片產生器",
    subtitle: "照片 → 雙語腳本（英 + Tagalog）→ 旁白 → 9:16 直式 MP4，一鍵搞定",
    help_link: "📖 使用說明",

    sec_photos: "1️⃣ 商品照片 / 影片",
    dz_drag: "📷 拖曳照片或影片到這裡，或",
    dz_pick: "點此選擇",
    dz_hint: "照片：JPG/PNG/WebP/GIF　影片：MP4/MOV/WebM（自動擷取 6 個關鍵畫面餵給 AI）",
    url_label: "🔗 或貼影片連結（FB / YouTube / TikTok / IG，會自動下載）",
    url_placeholder: "https://www.facebook.com/share/v/...\nhttps://www.tiktok.com/@user/video/...",

    sec_info: "2️⃣ 商品資訊",
    f_name: "商品名稱",
    f_name_ph: "永生玫瑰禮盒",
    f_price: "價格",
    f_price_ph: "NT$1280",
    f_notes: "賣點 / 補充",
    f_notes_ph: "情人節熱賣、可保存3年、附手寫卡片",
    f_seconds: "影片秒數",
    f_lang: "語言版本",
    f_lang_all: "兩種都做（en + tl）",
    f_lang_en: "只做英文",
    f_lang_tl: "只做他加祿語",
    f_web: "啟用網路搜尋（讓 AI 抓趨勢/熱門 hashtag，多 ~$0.01–0.03）",

    sec_extra: "3️⃣ 進階素材（選填）",
    f_music: "背景音樂（mp3/wav）",
    f_logo: "品牌 Logo（透明 PNG）",
    f_extra_hint: "沒上傳時：自動找 <code>music/bgm.mp3</code> 與 <code>LOGO.png</code>，找不到就跳過。",

    submit: "🚀 開始製作",
    submit_uploading: "上傳中…",

    progress_title: "製作進度",
    phase0: "🔗 下載連結",
    phase1: "📝 Phase 1：腳本",
    phase2: "🎙 Phase 2：旁白",
    phase3: "🎬 Phase 3：影片",

    review_title: "📝 審稿閘門",
    review_desc: "Phase 1 已完成。請檢查腳本，可直接點擊內文修改，或展開下方進階區編輯原始 JSON。",
    review_advanced: "進階：直接編輯原始 JSON（不熟悉 JSON 格式請勿改）",
    approve: "✅ 接受、繼續做旁白 + 影片",
    approve_sent: "已送出，繼續做語音與影片…",
    cancel: "取消",

    done_title: "🎉 完成！",
    restart: "再做一支",

    // dynamic
    err_no_photo: "至少要上傳 1 張照片",
    err_prefix: "錯誤：",
    confirm_invalid_json: "進階 JSON 格式有誤，是否改用上面的可編輯預覽內容繼續？",
    confirm_cancel: "確定取消？",
    summary_prefix: "📸 ",
    hook_label: "HOOK：",
    cta_label: "CTA：",
    lbl_english: "🇬🇧 English",
    lbl_tagalog: "🇵🇭 Tagalog",
  },

  en: {
    title: "🌸 BINI Blooms Promo Video Generator",
    subtitle: "Photos → bilingual script (EN + Tagalog) → voiceover → 9:16 MP4, in one click",
    help_link: "📖 Help",

    sec_photos: "1️⃣ Product photos or video",
    dz_drag: "📷 Drop photos or video here, or",
    dz_pick: "click to choose",
    dz_hint: "Photos: JPG/PNG/WebP/GIF　Video: MP4/MOV/WebM (6 key frames will be auto-extracted for the AI)",
    url_label: "🔗 Or paste a video link (FB / YouTube / TikTok / IG, auto-downloaded)",
    url_placeholder: "https://www.facebook.com/share/v/...\nhttps://www.tiktok.com/@user/video/...",

    sec_info: "2️⃣ Product info",
    f_name: "Product name",
    f_name_ph: "Forever Rose Gift Box",
    f_price: "Price",
    f_price_ph: "NT$1280",
    f_notes: "Selling points / notes",
    f_notes_ph: "Valentine's bestseller, lasts 3 years, comes with a handwritten card",
    f_seconds: "Video length (seconds)",
    f_lang: "Output language",
    f_lang_all: "Both (en + tl)",
    f_lang_en: "English only",
    f_lang_tl: "Tagalog only",
    f_web: "Enable web search (let Claude grab trends & hashtags, +~$0.01–0.03)",

    sec_extra: "3️⃣ Extras (optional)",
    f_music: "Background music (mp3/wav)",
    f_logo: "Brand logo (transparent PNG)",
    f_extra_hint: "If not uploaded: falls back to <code>music/bgm.mp3</code> and <code>LOGO.png</code>; skipped if missing.",

    submit: "🚀 Start",
    submit_uploading: "Uploading…",

    progress_title: "Progress",
    phase0: "🔗 Download",
    phase1: "📝 Phase 1: Script",
    phase2: "🎙 Phase 2: Voiceover",
    phase3: "🎬 Phase 3: Video",

    review_title: "📝 Review gate",
    review_desc: "Phase 1 done. Review the script — click any line to edit inline, or expand the advanced panel to edit raw JSON.",
    review_advanced: "Advanced: edit raw JSON (skip if you're not comfortable with JSON)",
    approve: "✅ Accept & continue to voiceover + video",
    approve_sent: "Sent. Continuing with voiceover + video…",
    cancel: "Cancel",

    done_title: "🎉 Done!",
    restart: "Make another",

    err_no_photo: "Upload at least 1 photo",
    err_prefix: "Error: ",
    confirm_invalid_json: "Advanced JSON has syntax errors. Continue with the inline-edited version above instead?",
    confirm_cancel: "Cancel this job?",
    summary_prefix: "📸 ",
    hook_label: "HOOK: ",
    cta_label: "CTA: ",
    lbl_english: "🇬🇧 English",
    lbl_tagalog: "🇵🇭 Tagalog",
  },
};

const STORAGE_KEY = "bini_ui_lang";
let currentLang = localStorage.getItem(STORAGE_KEY) || (navigator.language.startsWith("en") ? "en" : "zh");

window.t = function (key) {
  return (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) || TRANSLATIONS.zh[key] || key;
};

function applyI18n() {
  document.documentElement.lang = currentLang === "en" ? "en" : "zh-Hant";
  document.title = window.t("title");

  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = window.t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    el.innerHTML = window.t(el.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = window.t(el.dataset.i18nPlaceholder);
  });

  document.querySelectorAll(".lang-switch button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.setLang === currentLang);
  });

  // 讓 app.js 重繪它自己的動態片段（審稿預覽、完成清單）
  window.dispatchEvent(new CustomEvent("i18n:changed", { detail: { lang: currentLang } }));
}

window.setLang = function (lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  applyI18n();
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".lang-switch button").forEach(btn => {
    btn.addEventListener("click", () => window.setLang(btn.dataset.setLang));
  });
  applyI18n();
});
