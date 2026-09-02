"use strict";
/* ============================================================
   Quietly Here — phone web app (API-backed)
   ============================================================ */

/* device-local prefs only (dark mode, language, saved list, progress, nickname) */
const store = (() => {
  let mem = {};
  try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); }
  catch (e) { return { get: k => mem[k] ?? null, set: (k, v) => { mem[k] = String(v); } }; }
  return { get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) };
})();
const lsGet = (k, d) => { try { const v = store.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const lsSet = (k, v) => store.set(k, JSON.stringify(v));

/* stable per-device id (for block-by-device + "my reactions") */
function deviceId() {
  let id = store.get("qh.device");
  if (!id) { id = "d_" + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("qh.device", id); }
  return id;
}

/* ---------- API client ---------- */
const api = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || r.statusText); return r.json(); },
  async post(url, body) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; }
};

const TOPICS = {
  life:    { en:"Life",      sw:"Maisha",    descEn:"The everyday — money, work, routines, the home.",   descSw:"Ya kila siku — fedha, kazi, mazoea, nyumbani.",   grad:"grad-teal" },
  people:  { en:"People",    sw:"Watu",      descEn:"Marriage, family, relationships, the people around us.", descSw:"Ndoa, familia, mahusiano, watu walio karibu nasi.", grad:"grad-olive" },
  moments: { en:"Moments",   sw:"Nyakati",   descEn:"Culture, traditions, rites of passage, memories.", descSw:"Utamaduni, mila, matukio muhimu, kumbukumbu.",      grad:"grad-clay" },
  hope:    { en:"Hope",      sw:"Matumaini", descEn:"Healing, faith, mental health, moving forward.",   descSw:"Uponyaji, imani, afya ya akili, kusonga mbele.",    grad:"grad-amber" }
};
const topicName = (k) => state.lang === "sw" ? TOPICS[k].sw : TOPICS[k].en;
const topicDesc = (k) => state.lang === "sw" ? TOPICS[k].descSw : TOPICS[k].descEn;

/* ---------- app state ---------- */
const state = {
  lang: lsGet("qh.lang", "en"),
  dark: lsGet("qh.dark", false),
  user: null,               // {id,email,name,confirmed} once signed in
  authMode: "in",           // 'in' | 'up' — sign-in vs create-account tab
  authNext: null,           // action to resume after a successful sign-in
  guestName: lsGet("qh.guestName", ""),
  saved: lsGet("qh.saved", []),
  reactedComments: lsGet("qh.reactedComments", {}),  // {storyId:{commentId:type}}
  progress: lsGet("qh.progress", {}),
  recents: lsGet("qh.recents", []),
  view: "home", readerId: null, topic: null,
  searchTopic: "all", searchLang: "all", searchSort: "new", searchQ: "",
  libTab: "saved", pendingComment: null, subFile: false,
  // per-view data caches
  homeStories: [], topicStories: [], searchStories: [], reader: null
};
const I18N = {
  en:{
    nav:{home:"Home",search:"Search",library:"Library"},
    tagline:"Read in silence. Speak without judgment.",
    featured:"Featured",
    latest:"Latest stories",
    browseBy:"Browse by topic",
    topics:"Topics",
    write:"Write a story",
    search:"Search",
    searchPh:"Search stories, writers, topics…",
    searchSub:"Stories, writers & topics — in English and Kiswahili",
    recent:"Recent",
    results:"stories found",
    filters:"Filter",
    sortNew:"Newest", sortRead:"Most read", sortLoved:"Most loved",
    allTopics:"All topics",
    read:"min read", reads:"reads",
    comments:"Comments", comment:"comment",
    reactLike:"Like",reactLove:"Love",reactCare:"Care",
    save:"Save",saved:"Saved",
    related:"More like this",
    submitTitle:"Write a story",
    submitSub:"Your story will be reviewed by the moderator before publishing. Pen names are welcome.",
    fTitle:"Story title", fTitlePh:"A title that invites reading",
    fTopic:"Topic", fLang:"Language", fLangEn:"English", fLangSw:"Kiswahili",
    fBody:"Your story", fBodyPh:"Write from the heart. 250–700 words feels right.",
    fPen:"Pen name (public)", fPenPh:"e.g. Polepole, Mvua ya Usiku",
    fImg:"Add a photo (optional)", fImgHint:"Only your own photos, or with the people in them consenting. The moderator approves every image.",
    fContact:"How can we reach you?", fContactHint:"Email or WhatsApp. Guests need this so we can reply about your story. Members can skip it.",
    fSubmit:"Send story for review",
    fAgree:"By submitting, you allow Quietly Here to publish and lightly edit your story. You keep credit under your pen name.",
    subSent:"Story received",
    subSentBody:"Thank you for trusting us with your words. Our moderator will review it — usually within a few days.",
    subStatus:"Pending review",
    authTitle:"Welcome",
    authSub:"Accounts are for saving stories, submitting your writing and reporting comments. Reading is always free — no account needed.",
    signIn:"Sign in", signUp:"Create account",
    email:"Email", emailPh:"you@example.com",
    pass:"Password", passPh:"At least 6 characters",
    name:"Display name (pen name encouraged)", namePh:"e.g. Polepole",
    forgot:"Forgot password?",
    guest:"Continue as guest",
    terms:"By creating an account you agree to our Community Rules and Privacy Policy.",
    authDone:"Signed in — karibu!",
    authWhy:"Why an account?",
    authWhyB:"To keep this a safe, spam-free space, saving stories, submitting writing and reporting comments need a confirmed email. Reading and commenting stay open to everyone.",
    haveAcc:"Already have an account?", noAcc:"New here?",
    checkEmail:"Check your email",
    checkEmailB:"We've sent a confirmation link to your inbox. Tap it to activate your account — then come back and sign in.",
    resendEmail:"Resend the email", resent:"Sent! Check your inbox.",
    confirmFirst:"Please confirm your email first — check your inbox for the link.",
    signedInAs:"Signed in as", account:"Account", signInBtn:"Sign in", createBtn:"Create account",
    gateSave:"Sign in to save stories to your library.",
    gateSubmit:"Sign in to share your story. Accounts help us keep submissions genuine.",
    gateReport:"Sign in to report a comment. This keeps reporting fair and spam-free.",
    myAccount:"My account", notSignedIn:"You're reading as a guest",
    libTitle:"Library",
    guestNote:"You're reading as a guest",
    guestNoteBody:"Everything on Quietly Here is free to read without an account. Sign in to save stories, track progress and submit your writing.",
    tabSaved:"Saved", tabProgress:"Progress", tabSubs:"My submissions", tabSettings:"Settings",
    noSaved:"Nothing saved yet. Tap Save on any story.",
    savedElsewhere:"Open a story once so it appears here.",
    noProgress:"You haven't started a story yet.",
    noSubs:"You haven't submitted a story yet.",
    settingDark:"Dark mode", settingLang:"Language", settingNotifs:"Notifications (off for now)",
    signOut:"Sign out", deleteAcc:"Delete my data",
    helpTitle:"Get help",
    helpSub:"Quietly Here is a story app, not a clinic — but you are never alone.",
    hMission:"Our mission", hMissionB:"We publish real stories about real Kenyan life — so no one carries their struggles in silence.",
    hRules:"Community rules", r1:"Be kind — this is a judgment-free space.", r2:"No bullying, hate speech or shaming.", r3:"No spam or self-promotion.", r4:"If someone is hurting, point them to help — not debate.", r5:"Report, don't fight back.",
    hCrisis:"If you are in crisis right now", hCrisisB:"These services are free, confidential and ready to listen. You are not a burden.",
    hReport:"Report abuse", hReportB:"Every comment has a report button. Our moderator reviews reports and blocks repeat offenders — by nickname, device and IP.",
    hContact:"Contact us", hContactB:"Reach the moderator directly — we reply within a day.",
    ctTitle:"Contact us",
    ctSub:"Questions, a problem to report, or just want to say hello? Reach the team directly — we read every message.",
    ctName:"Your name (optional)", ctEmail:"Your email (optional)",
    ctSubject:"Subject", ctSubjectPh:"What's this about?",
    ctMsg:"Message", ctMsgPh:"Tell us what's on your mind…",
    ctSend:"Send message",
    ctViaEmail:"This opens your email app, ready to send to our inbox.",
    ctReach:"Other ways to reach us",
    ctEmailLabel:"Email", ctFollowLabel:"Facebook", ctLocationLabel:"Location",
    ctLocationVal:"Nairobi, Kenya",
    menuContact:"Contact us",
    back:"Back", more:"More", close:"Close",
    toastReported:"Reported — thank you. The moderator will review it.",
    toastSaved:"Saved to your library.", toastRemoved:"Removed from your library.",
    toastReacted:"Reaction noted — karibu.", toastNick:"Thanks — your nickname is set.",
    toastSent:"Story sent for review!", toastSignOut:"Signed out. You're reading as a guest again.",
    toastDelete:"Demo: data deletion is a real feature in the app.",
    needNick:"Please choose a nickname to join the conversation (it's how we keep this space safe).",
    nickPh:"Your nickname", nickBtn:"Start commenting",
    guestSay:"as guest", youSay:"You",
    reportC:"Report",
    reportPh:"Report this comment", reportReason1:"Bullying", reportReason2:"Spam", reportReason3:"Hate speech", reportReason4:"Self-harm risk", reportReason5:"Other",
    sendReport:"Send report",
    allLangs:"All",
    sort:"Sort",
    noResults:"No stories match — try another word.",
    progressPct:"read",
    tough:"Contains tough content",
    toughNote:"This story deals with heavy experiences. Read gently, and know you can stop anytime.",
    toughBy:"Marked by the moderator.",
    helpLineT:"If this story touched you and you feel heavy, you are not alone.",
    langFull:"Kiswahili", langShort:"EN", dark:"Dark",
    menuHome:"Home", menuTopics:"Topics", menuSearch:"Search", menuWrite:"Write a story", menuLibrary:"Library", menuHelp:"Get help",
    browse:"Browse", yourspace:"Your space",
    a11yMenu:"Open menu", a11yBack:"Go back", a11yWrite:"Write a story",
    a11yLang:"Switch language", a11yDark:"Switch to dark mode", a11yLight:"Switch to light mode",
    a11ySend:"Post comment",
    penNote:"Writing under a pen name",
    topicCount:(n)=>`${n} ${n===1?"story":"stories"}`
  },
  sw:{
    nav:{home:"Nyumbani",search:"Tafuta",library:"Maktaba"},
    tagline:"Soma kimya. Zungumza bila hukumu.",
    featured:"Makala Bora",
    latest:"Hadithi za hivi punde",
    browseBy:"Vinjari kwa mada",
    topics:"Mada",
    write:"Andika hadithi",
    search:"Tafuta",
    searchPh:"Tafuta hadithi, waandishi, mada…",
    searchSub:"Hadithi, waandishi na mada — kwa Kiingereza na Kiswahili",
    recent:"Zilizotafutwa",
    results:"hadithi zimepatikana",
    filters:"Chuja",
    sortNew:"Mpya", sortRead:"Zimesomwa zaidi", sortLoved:"Zinazopendwa zaidi",
    allTopics:"Mada zote",
    read:"dakika", reads:"wasomaji",
    comments:"Maoni", comment:"maoni",
    reactLike:"Penda",reactLove:"Upendo",reactCare:"Jali",
    save:"Hifadhi",saved:"Imehifadhiwa",
    related:"Nyingine kama hii",
    submitTitle:"Andika hadithi",
    submitSub:"Hadithi yako itakaguliwa na msimamizi kabla ya kuchapishwa. Majina ya kalamu yanakaribishwa.",
    fTitle:"Kichwa cha hadithi", fTitlePh:"Kichwa kinachovuta usomaji",
    fTopic:"Mada", fLang:"Lugha", fLangEn:"Kiingereza", fLangSw:"Kiswahili",
    fBody:"Hadithi yako", fBodyPh:"Andika kutoka moyoni. Maneno 250–700 yanatosha.",
    fPen:"Jina la kalamu (linajulikana)", fPenPh:"mf. Polepole, Mvua ya Usiku",
    fImg:"Ongeza picha (si lazima)", fImgHint:"Picha zako mwenyewe tu, au watu walioridhia. Msimamizi anakagua kila picha.",
    fContact:"Tukufikie vipi?", fContactHint:"Barua pepe au WhatsApp. Wageni wanahitaji hii ili tujibu kuhusu hadithi yako. Wanachama wanaweza kuiruka.",
    fSubmit:"Tuma hadithi kwa ukaguzi",
    fAgree:"Kwa kutuma, unaruhusu Quietly Here kuchapisha na kuhariri kidogo hadithi yako. Wewe unabaki na sifa chini ya jina lako la kalamu.",
    subSent:"Hadithi imepokelewa",
    subSentBody:"Asante kwa kuamini maneno yako kwetu. Msimamizi atakagua — kawaida ndani ya siku chache.",
    subStatus:"Inasubiri ukaguzi",
    authTitle:"Karibu",
    authSub:"Akaunti ni za kuhifadhi hadithi, kutuma maandishi na kuripoti maoni. Kusoma ni bure kila wakati — hakuna akaunti inayohitajika.",
    signIn:"Ingia", signUp:"Unda akaunti",
    email:"Barua pepe", emailPh:"you@example.com",
    pass:"Nenosiri", passPh:"Angalau herufi 6",
    name:"Jina linaloonekana (jina la kalamu linapendekezwa)", namePh:"mf. Polepole",
    forgot:"Umesahau nenosiri?",
    guest:"Endelea kama mgeni",
    terms:"Kwa kuunda akaunti unakubali Sheria za Jumuiya na Sera ya Faragha.",
    authDone:"Umeingia — karibu!",
    authWhy:"Kwa nini akaunti?",
    authWhyB:"Ili kulinda nafasi hii salama na bila spam, kuhifadhi hadithi, kutuma maandishi na kuripoti maoni kunahitaji barua pepe iliyothibitishwa. Kusoma na kutoa maoni kunabaki wazi kwa wote.",
    haveAcc:"Tayari una akaunti?", noAcc:"Ni mgeni hapa?",
    checkEmail:"Angalia barua pepe yako",
    checkEmailB:"Tumetuma kiungo cha uthibitisho kwenye sanduku lako. Gusa ili kuamilisha akaunti yako — kisha rudi uingie.",
    resendEmail:"Tuma barua pepe tena", resent:"Imetumwa! Angalia sanduku lako.",
    confirmFirst:"Tafadhali thibitisha barua pepe yako kwanza — angalia sanduku lako.",
    signedInAs:"Umeingia kama", account:"Akaunti", signInBtn:"Ingia", createBtn:"Unda akaunti",
    gateSave:"Ingia ili kuhifadhi hadithi kwenye maktaba yako.",
    gateSubmit:"Ingia ili kushiriki hadithi yako. Akaunti hutusaidia kuhakikisha uwasilishaji ni halali.",
    gateReport:"Ingia ili kuripoti maoni. Hii huweka uripotaji wa haki na bila spam.",
    myAccount:"Akaunti yangu", notSignedIn:"Unasoma kama mgeni",
    libTitle:"Maktaba",
    guestNote:"Unasoma kama mgeni",
    guestNoteBody:"Kila kitu kwenye Quietly Here kinasomika bila akaunti. Ingia ili kuhifadhi hadithi, kufuatilia maendeleo na kutuma maandishi.",
    tabSaved:"Zilizohifadhiwa", tabProgress:"Maendeleo", tabSubs:"Uwasilishaji wangu", tabSettings:"Mipangilio",
    noSaved:"Hakuna kilichohifadhiwa. Gusa Hifadhi kwenye hadithi yoyote.",
    savedElsewhere:"Fungua hadithi ili ionekane hapa.",
    noProgress:"Hujaanza hadithi bado.",
    noSubs:"Hujatuma hadithi bado.",
    settingDark:"Hali ya giza", settingLang:"Lugha", settingNotifs:"Arifa (zimezimwa kwa sasa)",
    signOut:"Toka", deleteAcc:"Futa data yangu",
    helpTitle:"Pata msaada",
    helpSub:"Quietly Here ni app ya hadithi, si kliniki — lakini huwa wewe si peke yako.",
    hMission:"Dhamira yetu", hMissionB:"Tunachapisha hadithi za kweli kuhusu maisha ya Kikenya — ili hakuna mtu anayebeba taabu zake kimya kimya.",
    hRules:"Sheria za jumuiya", r1:"Kuwa mwema — hii ni nafasi isiyo na hukumu.", r2:"Hakuna unyanyasaji, chuki wala kuaibisha.", r3:"Hakuna spam wala kujitangaza.", r4:"Mtu akiumia, mwelekeze kwenye msaada — si mabishano.", r5:"Ripoti, usipigane nyuma.",
    hCrisis:"Ikiwa uko kwenye hatari sasa hivi", hCrisisB:"Huduma hizi ni bure, za siri na ziko tayari kukusikiliza. Wewe si mzigo.",
    hReport:"Ripoti unyanyasaji", hReportB:"Kila maoni yana kitufe cha ripoti. Msimamizi anakagua ripoti na kufunga wanaokiuka — kwa jina, kifaa na IP.",
    hContact:"Wasiliana nasi", hContactB:"Mfikie msimamizi moja kwa moja — tunajibu ndani ya siku moja.",
    ctTitle:"Wasiliana nasi",
    ctSub:"Una swali, tatizo la kuripoti, au unataka kusalimia tu? Wasiliana na timu moja kwa moja — tunasoma kila ujumbe.",
    ctName:"Jina lako (si lazima)", ctEmail:"Barua pepe yako (si lazima)",
    ctSubject:"Mada", ctSubjectPh:"Ni kuhusu nini?",
    ctMsg:"Ujumbe", ctMsgPh:"Tuambie kilichoko moyoni mwako…",
    ctSend:"Tuma ujumbe",
    ctViaEmail:"Hii itafungua app yako ya barua pepe, tayari kutuma kwa sanduku letu.",
    ctReach:"Njia nyingine za kutufikia",
    ctEmailLabel:"Barua pepe", ctFollowLabel:"Facebook", ctLocationLabel:"Mahali",
    ctLocationVal:"Nairobi, Kenya",
    menuContact:"Wasiliana nasi",
    back:"Rudi", more:"Zaidi", close:"Funga",
    toastReported:"Imeripotiwa — asante. Msimamizi atakagua.",
    toastSaved:"Imehifadhiwa kwenye maktaba yako.", toastRemoved:"Imeondolewa kwenye maktaba yako.",
    toastReacted:"Imepokelewa — karibu.", toastNick:"Asante — jina lako limewekwa.",
    toastSent:"Hadithi imetumwa kwa ukaguzi!", toastSignOut:"Umetoka. Unasoma kama mgeni tena.",
    toastDelete:"Demo: kufuta data ni kipengele halisi kwenye app.",
    needNick:"Chagua jina ili ujiunge na mazungumzo (ndivyo tunavyolinda nafasi hii).",
    nickPh:"Jina lako", nickBtn:"Anza kutoa maoni",
    guestSay:"kama mgeni", youSay:"Wewe",
    reportC:"Ripoti",
    reportPh:"Ripoti maoni haya", reportReason1:"Unyanyasaji", reportReason2:"Spam", reportReason3:"Chuki", reportReason4:"Hatari ya kujidhuru", reportReason5:"Nyingine",
    sendReport:"Tuma ripoti",
    allLangs:"Zote",
    sort:"Panga",
    noResults:"Hakuna hadithi inayolingana — jaribu neno lingine.",
    progressPct:"imesomwa",
    tough:"Ina maudhui magumu",
    toughNote:"Hadithi hii inahusu uzoefu mzito. Soma kwa upole, na ujue unaweza kusimama wakati wowote.",
    toughBy:"Imeashiriwa na msimamizi.",
    helpLineT:"Ikiwa hadithi hii imekugusa na unahisi mzigo mzito, wewe si peke yako.",
    langFull:"English", langShort:"SW", dark:"Giza",
    menuHome:"Nyumbani", menuTopics:"Mada", menuSearch:"Tafuta", menuWrite:"Andika hadithi", menuLibrary:"Maktaba", menuHelp:"Pata msaada",
    browse:"Vinjari", yourspace:"Nafasi yako",
    a11yMenu:"Fungua menyu", a11yBack:"Rudi nyuma", a11yWrite:"Andika hadithi",
    a11yLang:"Badilisha lugha", a11yDark:"Washa hali ya giza", a11yLight:"Washa hali ya mwanga",
    a11ySend:"Tuma maoni",
    penNote:"Anaandika kwa jina la kalamu",
    topicCount:(n)=>`${n} ${n===1?"hadithi":"hadithi"}`
  }
};
const tt = key => {
  const en = I18N.en, sw = I18N.sw;
  const pick = state.lang==="sw" ? sw : en;
  const k = key.split(".");
  let o = pick;
  for(const p of k){ o = o && o[p]; }
  if(typeof o === "function") return o;
  if(o !== undefined && o !== null) return o;
  o = en;
  for(const p of k){ o = o && o[p]; }
  if(typeof o === "function") return o;
  return (o !== undefined && o !== null) ? o : key;
};
const esc = s => String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

/* contact details — edit here to change everywhere */
const CONTACT = {
  email: "write@quiettruths.co.ke",
  facebook: "",                 // full https://facebook.com/... URL, or "" to hide
  location: "Nairobi, Kenya"
};

const HELPLINES=[
  {n:"1199", svc:"Kenya Red Cross · Mental Health (toll-free, 24/7)", tel:"1199"},
  {n:"1190", svc:"LVCT Health One2One · (+254 733 333 268)", tel:"1190"},
  {n:"+254 722 178 177", svc:"Befrienders Kenya · 24/7", tel:"+254722178177"},
  {n:"116", svc:"Childline Kenya · children & youth", tel:"116"}
];

/* ============================================================
   HELPERS
   ============================================================ */
const $ = sel => document.querySelector(sel);
const scrollEl = () => $("#scrollarea");
const storyTitle = s => state.lang === "sw" ? (s.titleSw || s.title) : s.title;
const fmtInt = n => (n || 0).toLocaleString();

const REACT_SVG = {
  like:'<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M2 20h3V9H2v11zm19.9-9.5c0-.9-.7-1.6-1.6-1.6h-5.1l.8-3.7v-.3c0-.4-.2-.8-.4-1L14.7 3 8.6 9.1c-.3.3-.5.7-.5 1.2V19c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.3-.4 1.5-1l2.4-5.7c.1-.2.1-.4.1-.6v-1.8z"/></svg>',
  love:'<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 21s-6.7-4.6-9.3-8.3C.9 10 1.6 6.4 4.5 5.2c2-.8 4.1-.1 5.3 1.4L12 9l2.2-2.4c1.2-1.5 3.3-2.2 5.3-1.4 2.9 1.2 3.6 4.8 1.8 7.5C18.7 16.4 12 21 12 21z"/></svg>',
  care:'<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 17.3s-4.6-3.1-6.4-5.7C4.3 9.7 4.8 7.3 6.8 6.5c1.4-.6 2.9 0 3.7 1l1.5 1.7 1.5-1.7c.8-1 2.3-1.6 3.7-1 2 .8 2.5 3.2 1.2 5.1-1.8 2.6-6.4 5.7-6.4 5.7zM2 20.5c.9-1.4 2.3-2.3 3.9-2.6M22 20.5c-.9-1.4-2.3-2.3-3.9-2.6"/></svg>'
};

function headHTML(s, cls) {
  const grad = TOPICS[s.topic] ? TOPICS[s.topic].grad : "grad-teal";
  return `<div class="art typo ${cls || ""} ${grad}"><span class="qmark">“</span><div class="bigq">${esc(s.pull || s.excerpt || "")}</div></div>`;
}
function cardHTML(s) {
  const langBadge = s.lang === "sw" ? "SW" : "EN";
  const tough = s.tough ? `<span class="tough">${tt("tough")}</span>` : "";
  return `<div class="card" data-action="open-story" data-id="${s.id}">${headHTML(s)}
    <div class="cbody">
      <div class="catrow"><span class="cat">${esc(topicName(s.topic))}</span><span class="langbadge">${langBadge}</span></div>
      <h3>${esc(storyTitle(s))}</h3>
      <p class="ex">${esc(s.excerpt || "")}</p>
      <div class="meta"><span>${esc(s.author)}</span><span class="dot"></span><span>${s.mins} ${tt("read")}</span><span class="dot"></span><span>${fmtInt(s.reads)} ${tt("reads")}</span>${tough}</div>
    </div></div>`;
}
function topbarHTML(markEmoji, titleText) {
  const acct = state.user
    ? `<button class="iconbtn" data-action="menu-nav" data-v="library" title="${esc(state.user.name)}" aria-label="${esc(state.user.name)}"><b>${esc((state.user.name||"?").charAt(0).toUpperCase())}</b></button>`
    : `<button class="iconbtn" data-action="goto-auth" title="${tt("signIn")}" aria-label="${tt("signIn")}">👤</button>`;
  return `<div class="topbar">
    <div class="logo"><div class="mark">${markEmoji || "🤫"}</div><div class="name" style="font-size:${titleText?15:17}px">${titleText || "Quietly Here"}${titleText?"":`<small>${tt("tagline")}</small>`}</div></div>
    ${acct}
    <button class="iconbtn" data-action="open-drawer" title="Menu">☰</button>
    <button class="iconbtn" data-action="toggle-lang" title="EN / SW"><b>${tt("langShort")}</b></button>
    <button class="iconbtn" data-action="toggle-dark">${state.dark?"☀️":"🌙"}</button>
  </div>`;
}

/* ============================================================
   VIEWS
   ============================================================ */
async function renderHome() {
  scrollEl().innerHTML = `<div class="view"><div class="loading">${tt("latest")}…</div></div>`;
  let stories = [];
  try { stories = await api.get("/api/stories?sort=new"); } catch (e) { return renderError(e); }
  state.homeStories = stories;
  const f = stories[0];
  const topicCards = Object.keys(TOPICS).map(k => `
    <button class="topiccard ${TOPICS[k].grad}" data-action="open-topic" data-t="${k}">
      <b>${esc(topicName(k))}</b><span>${esc(topicDesc(k))}</span></button>`).join("");
  const latest = stories.map(cardHTML).join("");
  scrollEl().innerHTML = `<div class="view">
    ${topbarHTML()}
    ${f ? `<div class="hero card" data-action="open-story" data-id="${f.id}">${headHTML(f,"hero")}
      <div class="cbody"><div class="catrow"><span class="cat">${tt("featured")} · ${esc(topicName(f.topic))}</span><span class="langbadge">${f.lang==="sw"?"SW":"EN"}</span></div>
        <h3>${esc(storyTitle(f))}</h3><p class="ex">${esc(f.excerpt||"")}</p>
        <div class="meta"><span>${esc(f.author)}</span><span class="dot"></span><span>${f.mins} ${tt("read")}</span><span class="dot"></span><span>${fmtInt(f.reads)} ${tt("reads")}</span></div></div></div>` : ""}
    <div class="sec-title">${tt("browseBy")}</div>
    <div class="topicstrip">${topicCards}</div>
    <div class="sec-title">${tt("latest")}</div>
    ${latest || `<div class="notebox">${tt("noResults")}</div>`}
  </div>`;
}

async function renderTopic() {
  const k = state.topic; const meta = TOPICS[k];
  scrollEl().innerHTML = `<div class="view"><div class="loading">…</div></div>`;
  let list = [];
  try { list = await api.get("/api/stories?topic=" + encodeURIComponent(k)); } catch (e) { return renderError(e); }
  scrollEl().innerHTML = `<div class="view">
    <div class="backbar"><button class="back" data-action="back">←</button><div class="backtitle">${esc(topicName(k))}</div>
      <button class="iconbtn" data-action="toggle-lang" style="margin-left:auto"><b>${tt("langShort")}</b></button>
      <button class="iconbtn" data-action="toggle-dark">${state.dark?"☀️":"🌙"}</button></div>
    <div class="tbanner ${meta.grad}"><div class="tn">${esc(topicName(k))}</div><div class="td">${esc(topicDesc(k))}</div>
      <div class="tc">${esc(tt("topicCount")(list.length))}</div></div>
    ${list.length ? list.map(cardHTML).join("") : `<div class="notebox">${tt("noResults")}</div>`}
  </div>`;
}

async function renderSearch() {
  const chips = ["all", ...Object.keys(TOPICS)];
  const chipHTML = chips.map(c => `<button class="chip ${state.searchTopic===c?"on":""}" data-action="stopic" data-t="${c}">${c==="all"?tt("allTopics"):esc(topicName(c))}</button>`).join("");
  const recents = state.recents.length ? `<div class="recents">${tt("recent")}: ${state.recents.slice(0,5).map(r=>`<span data-action="use-recent" data-q="${esc(r)}">${esc(r)}</span>`).join("")}</div>` : "";
  scrollEl().innerHTML = `<div class="view">
    <div class="topbar"><div class="logo"><div class="mark">🔍</div><div class="name" style="font-size:15px">${tt("search")}</div></div>
      <button class="iconbtn" data-action="toggle-lang"><b>${tt("langShort")}</b></button>
      <button class="iconbtn" data-action="toggle-dark">${state.dark?"☀️":"🌙"}</button></div>
    <div class="searchbox"><span style="color:var(--muted)">🔍</span>
      <input id="searchinput" type="text" placeholder="${tt("searchPh")}" value="${esc(state.searchQ)}" autocomplete="off"></div>
    ${recents}
    <div class="filterrow">
      <select class="sortsel" data-action="sort" title="${tt("sort")}">
        <option value="new" ${state.searchSort==="new"?"selected":""}>${tt("sortNew")}</option>
        <option value="read" ${state.searchSort==="read"?"selected":""}>${tt("sortRead")}</option>
      </select>
      <div class="pillgroup">
        <button class="pill ${state.searchLang==="all"?"on":""}" data-action="slang" data-v="all">${tt("allLangs")}</button>
        <button class="pill ${state.searchLang==="en"?"on":""}" data-action="slang" data-v="en">EN</button>
        <button class="pill ${state.searchLang==="sw"?"on":""}" data-action="slang" data-v="sw">SW</button>
      </div></div>
    <div class="chips">${chipHTML}</div>
    <div id="searchresults"><div class="loading">…</div></div>
  </div>`;
  renderResults();
}
async function renderResults() {
  const el = $("#searchresults"); if (!el) return;
  const params = new URLSearchParams();
  if (state.searchTopic !== "all") params.set("topic", state.searchTopic);
  if (state.searchLang !== "all") params.set("lang", state.searchLang);
  if (state.searchQ.trim()) params.set("q", state.searchQ.trim());
  params.set("sort", state.searchSort);
  let res = [];
  try { res = await api.get("/api/stories?" + params.toString()); } catch (e) { el.innerHTML = `<div class="notebox">${esc(e.message)}</div>`; return; }
  state.searchStories = res;
  el.innerHTML = `<div class="rescount">${res.length} ${tt("results")}</div>` +
    (res.length ? res.map(cardHTML).join("") : `<div class="notebox">${tt("noResults")}</div>`);
}

async function renderReader() {
  scrollEl().innerHTML = `<div class="view"><div class="loading">…</div></div>`;
  let data;
  try { data = await api.get("/api/stories/" + state.readerId); } catch (e) { return renderError(e); }
  const s = data.story; state.reader = data;
  const langBadge = s.lang === "sw" ? "SW" : "EN";
  const saved = state.saved.includes(s.id);
  const commentHTML = data.comments.map((c) => {
    const reacts = [["like"],["love"],["care"]].map(([k]) => {
      const on = c.mine === k;   // server tells us this device's reaction
      const count = c[k + "s"] || 0;
      const label = tt("react" + k[0].toUpperCase() + k.slice(1));
      return `<button class="cr ${on?"on":""}" type="button" data-action="creact" data-cid="${c.id}" data-type="${k}" aria-pressed="${on}" aria-label="${label} (${count})"><span class="e" aria-hidden="true">${REACT_SVG[k]}</span>${count}</button>`;
    }).join("");
    return `<div class="comment"><div class="cavatar">${esc(c.name.charAt(0).toUpperCase())}</div>
      <div class="cbody"><div class="cmeta"><span class="cname">${esc(c.name)}</span><span class="ctime">${esc(timeAgo(c.created_at))}</span></div>
        <div class="ctext">${esc(c.text)}</div>
        <div class="creacts">${reacts}<button class="creport" type="button" data-action="report" data-cid="${c.id}" aria-label="${tt("reportPh")}" title="${tt("reportPh")}">⚑ ${tt("reportC")}</button></div>
      </div></div>`;
  }).join("");

  const tough = s.tough ? `<div class="toughbox"><b>${tt("tough")}:</b> ${tt("toughNote")}<br><span class="small muted">${tt("toughBy")}</span></div>` : "";
  const helpline = s.helpline ? `<div class="helpline"><b>${tt("helpLineT")}</b><br>Kenya Red Cross: <b>1199</b> · LVCT One2One: <b>1190</b> · Befrienders: <b>+254 722 178 177</b></div>` : "";
  let related = "";
  try {
    const rel = (await api.get("/api/stories?topic=" + s.topic)).filter(x => x.id !== s.id).slice(0, 2);
    related = rel.map(cardHTML).join("");
  } catch (e) {}

  scrollEl().innerHTML = `<div class="view rbody" style="padding-bottom:120px">
    <div class="rtop backbar"><button class="back" data-action="back">←</button><div class="backtitle">${tt("back")}</div>
      <button class="iconbtn" data-action="toggle-lang" style="margin-left:auto"><b>${tt("langShort")}</b></button>
      <button class="iconbtn" data-action="toggle-dark">${state.dark?"☀️":"🌙"}</button></div>
    <div class="rcat">${esc(topicName(s.topic))} · ${langBadge}</div>
    <h1 class="rtitle">${esc(storyTitle(s))}</h1>
    <div class="rmeta"><span>${esc(s.author)}</span><span>·</span><span>${s.mins} ${tt("read")}</span><span>·</span><span>${esc(s.date)}</span><span>·</span><span>${fmtInt(s.reads)} ${tt("reads")}</span></div>
    ${headHTML(s,"rart")}
    ${tough}
    <div class="article">${s.body.map(p=>`<p>${esc(p)}</p>`).join("")}</div>
    ${helpline}
    <div class="byline"><div class="avatar">${esc(s.author.charAt(0).toUpperCase())}</div>
      <div><div class="nm">${esc(s.author)}</div><div class="pen">${tt("penNote")}</div></div></div>
    <div class="actionrow"><button class="abtn ${saved?"saved":""}" data-action="toggle-save">${saved?"✅ "+tt("saved"):"🔖 "+tt("save")}</button></div>
    <div class="comhead">💬 ${tt("comments")} <span class="pillcount">${data.comments.length}</span></div>
    ${commentHTML}
    <div class="cominput"><div class="who">${esc((state.guestName||"?").charAt(0).toUpperCase())}</div>
      <textarea id="comtext" placeholder="${tt("needNick")}"></textarea>
      <button class="sendbtn" data-action="send-comment" aria-label="${tt("a11ySend")}">➤</button></div>
    ${related?`<div class="related-title">${tt("related")}</div>${related}`:""}
  </div>`;
}

function renderSubmit() {
  const topicOpts = Object.keys(TOPICS).map(k => `<option value="${k}">${esc(topicName(k))}</option>`).join("");
  scrollEl().innerHTML = `<div class="view" style="padding-bottom:60px">
    <div class="backbar"><button class="back" data-action="back">←</button><div class="backtitle">${tt("submitTitle")}</div></div>
    <p class="muted small" style="margin:0 0 14px">${tt("submitSub")}</p>
    <div class="field"><label>${tt("fTitle")} *</label><input id="sub-title" placeholder="${tt("fTitlePh")}"></div>
    <div class="field"><label>${tt("fTopic")} *</label><select id="sub-topic">${topicOpts}</select></div>
    <div class="field"><label>${tt("fLang")} *</label><select id="sub-lang"><option value="en">${tt("fLangEn")}</option><option value="sw">${tt("fLangSw")}</option></select></div>
    <div class="field"><label>${tt("fBody")} *</label><textarea id="sub-body" placeholder="${tt("fBodyPh")}"></textarea></div>
    <div class="field"><label>${tt("fPen")} *</label><input id="sub-pen" placeholder="${tt("fPenPh")}" value="${esc((state.user&&state.user.name)||state.guestName||"")}"></div>
    <div class="field"><label>${tt("fContact")}</label><input id="sub-contact" placeholder="email@example.com / +254 7…" value="${esc((state.user&&state.user.email)||"")}"><div class="hint">${tt("fContactHint")}</div></div>
    <div class="notebox">${tt("fAgree")}</div>
    <button class="btn primary" data-action="submit-story">✉️ ${tt("fSubmit")}</button>
  </div>`;
}

function renderLibrary() {
  const tab = state.libTab;
  const tabs = [["saved","🔖"],["progress","📖"],["settings","⚙️"]];
  const tabHTML = tabs.map(([k,ic]) => `<button class="pill ${tab===k?"on":""}" data-action="libtab" data-v="${k}">${ic} ${tt("tab"+(k[0].toUpperCase()+k.slice(1)))}</button>`).join("");
  let body = "";
  if (tab === "saved") {
    const saved = (state.homeStories.length ? state.homeStories : []).filter(s => state.saved.includes(s.id));
    body = state.saved.length
      ? (saved.length ? saved.map(cardHTML).join("") : `<div class="notebox">${tt("savedElsewhere")}</div>`)
      : `<div class="notebox">${tt("noSaved")}</div>`;
  } else if (tab === "progress") {
    const prog = Object.entries(state.progress);
    body = prog.length ? prog.map(([id,pct]) => {
      const s = (state.homeStories||[]).find(x => x.id === +id);
      const title = s ? storyTitle(s) : ("#" + id);
      return `<div class="libcard" data-action="open-story" data-id="${id}" style="cursor:pointer">
        <h4>${esc(title)}</h4><div class="progressbar"><i style="width:${pct}%"></i></div>
        <div class="sub" style="margin-top:6px">${pct}% ${tt("progressPct")}</div></div>`;
    }).join("") : `<div class="notebox">${tt("noProgress")}</div>`;
  } else {
    const acct = state.user
      ? `<div class="libcard">
          <div class="setrow"><span><b>${tt("signedInAs")}</b><br><span class="muted small">${esc(state.user.name)} · ${esc(state.user.email)}</span></span>
            <button class="pill" data-action="sign-out" style="border:1px solid var(--line)">${tt("signOut")}</button></div>
        </div>`
      : `<div class="libcard">
          <div class="setrow"><span><b>${tt("notSignedIn")}</b><br><span class="muted small">${tt("authSub")}</span></span></div>
          <button class="btn primary" data-action="goto-auth" style="width:100%;margin-top:10px">→ ${tt("signIn")} / ${tt("signUp")}</button>
        </div>`;
    body = acct + `<div class="libcard">
      <div class="setrow"><span>${tt("settingDark")}</span><div class="toggle ${state.dark?"on":""}" data-action="toggle-dark"><i></i></div></div>
      <div class="setrow"><span>${tt("settingLang")} — ${tt("langFull")}</span><button class="pill" data-action="toggle-lang" style="border:1px solid var(--line)">${tt("langShort")}</button></div>
      <div class="setrow"><span>${tt("deleteAcc")}</span><button class="pill" data-action="delete-data" style="color:var(--rose);border:1px solid color-mix(in srgb,var(--rose) 40%,transparent)">${tt("deleteAcc")}</button></div>
    </div>`;
  }
  scrollEl().innerHTML = `<div class="view" style="padding-bottom:60px">
    <div class="topbar"><div class="logo"><div class="mark">📚</div><div class="name" style="font-size:15px">${tt("libTitle")}</div></div>
      <button class="iconbtn" data-action="toggle-lang"><b>${tt("langShort")}</b></button>
      <button class="iconbtn" data-action="toggle-dark">${state.dark?"☀️":"🌙"}</button></div>
    <div class="pillgroup" style="width:100%;justify-content:space-between">${tabHTML}</div>
    <div style="margin-top:14px">${body}</div></div>`;
}

function renderHelp() {
  const lines = HELPLINES.map(h => `<div class="hline"><div><div class="num">${h.n}</div><div class="svc">${h.svc}</div></div>
    <a class="call" href="tel:${h.tel}" title="Call">📞</a></div>`).join("");
  const rules = [1,2,3,4,5].map(i => `<li>${tt("r"+i)}</li>`).join("");
  scrollEl().innerHTML = `<div class="view" style="padding-bottom:60px">
    <div class="backbar"><button class="back" data-action="back">←</button><div class="backtitle">${tt("helpTitle")}</div></div>
    <div class="helpblock"><h4>🤫 ${tt("hMission")}</h4><p>${tt("hMissionB")}</p></div>
    <div class="helpblock"><h4>📜 ${tt("hRules")}</h4><ul style="padding-left:18px">${rules}</ul></div>
    <div class="helpblock" style="border-color:var(--teal)"><h4>🆘 ${tt("hCrisis")}</h4><p style="color:var(--muted)">${tt("hCrisisB")}</p>${lines}</div>
    <div class="helpblock"><h4>⚑ ${tt("hReport")}</h4><p>${tt("hReportB")}</p></div>
    <div class="helpblock" data-action="menu-nav" data-v="contact" style="cursor:pointer"><h4>✉️ ${tt("hContact")}</h4><p>${tt("hContactB")}</p>
      <div class="hline"><div><div class="num">${esc(CONTACT.email)}</div><div class="svc">${tt("ctReach")} →</div></div></div></div>
  </div>`;
}

function renderContact() {
  const fb = CONTACT.facebook
    ? `<a class="hline" href="${esc(CONTACT.facebook)}" target="_blank" rel="noopener" style="text-decoration:none">
         <div><div class="num">${esc(tt("ctFollowLabel"))}</div><div class="svc">${esc(CONTACT.facebook.replace(/^https?:\/\//,""))}</div></div>
         <span class="call" aria-hidden="true">↗</span></a>` : "";
  const mapQ = encodeURIComponent(CONTACT.location);
  scrollEl().innerHTML = `<div class="view" style="padding-bottom:60px">
    <div class="backbar"><button class="back" data-action="back">←</button><div class="backtitle">${tt("ctTitle")}</div></div>
    <p class="muted small" style="margin:0 0 16px;line-height:1.6">${tt("ctSub")}</p>

    <div class="field"><label>${tt("ctName")}</label><input id="ct-name" placeholder=""></div>
    <div class="field"><label>${tt("ctEmail")}</label><input id="ct-email" type="email" placeholder="you@example.com"></div>
    <div class="field"><label>${tt("ctSubject")} *</label><input id="ct-subject" placeholder="${tt("ctSubjectPh")}"></div>
    <div class="field"><label>${tt("ctMsg")} *</label><textarea id="ct-msg" placeholder="${tt("ctMsgPh")}"></textarea></div>
    <button class="btn primary" data-action="contact-send">✉️ ${tt("ctSend")}</button>
    <div class="hint" style="margin-top:8px">${tt("ctViaEmail")}</div>

    <div class="sec-title" style="margin-top:26px">${tt("ctReach")}</div>
    <a class="hline" href="mailto:${esc(CONTACT.email)}" style="text-decoration:none">
      <div><div class="num">${esc(tt("ctEmailLabel"))}</div><div class="svc">${esc(CONTACT.email)}</div></div>
      <span class="call" aria-hidden="true">✉️</span></a>
    ${fb}
    <a class="hline" href="https://www.google.com/maps/search/?api=1&query=${mapQ}" target="_blank" rel="noopener" style="text-decoration:none">
      <div><div class="num">${esc(tt("ctLocationLabel"))}</div><div class="svc">${esc(tt("ctLocationVal"))}</div></div>
      <span class="call" aria-hidden="true">📍</span></a>
  </div>`;
}

function renderAuth() {
  const up = state.authMode === "up";
  scrollEl().innerHTML = `<div class="view" style="padding-bottom:60px">
    <div class="backbar"><button class="back" data-action="back">←</button><div class="backtitle">${up ? tt("signUp") : tt("signIn")}</div></div>
    <div class="art typo grad-teal" style="height:120px;border-radius:16px;margin-bottom:18px"><span class="qmark">“</span><div class="bigq" style="font-size:18px">${esc(tt("authTitle"))}</div></div>
    <p class="muted small" style="margin:0 0 16px;line-height:1.6">${tt("authSub")}</p>
    <div class="pillgroup" style="width:100%;margin-bottom:16px">
      <button class="pill ${!up?"on":""}" data-action="auth-tab" data-v="in" style="flex:1">${tt("signIn")}</button>
      <button class="pill ${up?"on":""}" data-action="auth-tab" data-v="up" style="flex:1">${tt("signUp")}</button>
    </div>
    ${up ? `<div class="field"><label>${tt("name")} *</label><input id="au-name" placeholder="${tt("namePh")}"></div>` : ""}
    <div class="field"><label>${tt("email")} *</label><input id="au-email" type="email" placeholder="${tt("emailPh")}" autocomplete="email"></div>
    <div class="field"><label>${tt("pass")} *</label><input id="au-pass" type="password" placeholder="${tt("passPh")}" autocomplete="${up?"new-password":"current-password"}"></div>
    <button class="btn primary" data-action="${up?"do-signup":"do-login"}">${up ? "✨ "+tt("createBtn") : "→ "+tt("signInBtn")}</button>
    ${up ? `<div class="notebox" style="margin-top:12px">${tt("terms")}</div>` : ""}
    <div style="text-align:center;margin-top:16px" class="muted small">
      ${up ? tt("haveAcc") : tt("noAcc")}
      <a data-action="auth-tab" data-v="${up?"in":"up"}" style="color:var(--teal);font-weight:700;cursor:pointer">${up ? tt("signIn") : tt("signUp")}</a>
    </div>
    <div class="helpblock" style="margin-top:22px"><h4>🔒 ${tt("authWhy")}</h4><p class="muted small" style="line-height:1.6">${tt("authWhyB")}</p></div>
  </div>`;
}

function renderCheckEmail(email) {
  scrollEl().innerHTML = `<div class="view" style="padding-bottom:60px">
    <div class="backbar"><button class="back" data-action="back">←</button><div class="backtitle">${tt("checkEmail")}</div></div>
    <div class="success"><div class="big">📬</div><h3>${tt("checkEmail")}</h3>
      <p class="muted small" style="line-height:1.7;max-width:300px;margin:0 auto 18px">${tt("checkEmailB")}</p>
      <div style="margin-top:6px"><button class="btn ghost" data-action="resend-confirm" data-email="${esc(email||"")}">↻ ${tt("resendEmail")}</button></div>
      <div style="margin-top:14px"><button class="btn primary" data-action="goto-signin">→ ${tt("signIn")}</button></div>
    </div></div>`;
}

function renderError(e) {
  scrollEl().innerHTML = `<div class="view"><div class="notebox" style="margin-top:40px">
    ⚠️ ${esc((e && e.message) || "Something went wrong.")}<br><br>
    <button class="btn ghost" data-action="nav-home">↻ ${tt("nav.home")}</button></div></div>`;
}

/* time ago */
function timeAgo(iso) {
  const d = new Date(iso); if (isNaN(d)) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return state.lang==="sw"?"sasa hivi":"just now";
  const m = Math.floor(s/60); if (m < 60) return m + (state.lang==="sw"?" dk":"m");
  const h = Math.floor(m/60); if (h < 24) return h + (state.lang==="sw"?" saa":"h");
  const dd = Math.floor(h/24); return dd + (state.lang==="sw"?" siku":"d");
}
/* ============================================================
   DRAWER
   ============================================================ */
function renderDrawer() {
  const d = $("#drawer");
  const topics = Object.keys(TOPICS).map(k => `
    <div class="dtopic" data-action="menu-topic" data-t="${k}">
      <div class="sw ${TOPICS[k].grad}"><b>${esc(topicName(k).charAt(0))}</b></div>
      <div class="tx"><b>${esc(topicName(k))}</b><span>${esc(topicDesc(k))}</span></div></div>`).join("");
  d.innerHTML = `<div class="drawer-overlay" data-action="close-drawer"></div>
    <div class="drawerpanel">
      <div class="dbrand"><div class="mark">🤫</div><div class="name">Quietly Here<small>${tt("tagline")}</small></div></div>
      <div class="ditem" data-action="menu-nav" data-v="home"><span class="ic">🏠</span>${tt("menuHome")}</div>
      <div class="dsec">${tt("menuTopics")}</div>
      ${topics}
      <div class="dsec">${tt("browse")}</div>
      <div class="ditem" data-action="menu-nav" data-v="search"><span class="ic">🔍</span>${tt("menuSearch")}</div>
      <div class="ditem" data-action="open-submit"><span class="ic">✍️</span>${tt("menuWrite")}</div>
      <div class="dsec">${tt("yourspace")}</div>
      ${state.user
        ? `<div class="ditem" data-action="menu-nav" data-v="library"><span class="ic">👤</span>${esc(state.user.name)}</div>
           <div class="ditem" data-action="menu-signout"><span class="ic">🚪</span>${tt("signOut")}</div>`
        : `<div class="ditem" data-action="menu-auth"><span class="ic">👤</span>${tt("signIn")} / ${tt("signUp")}</div>`}
      <div class="ditem" data-action="menu-nav" data-v="library"><span class="ic">📚</span>${tt("menuLibrary")}</div>
      <div class="ditem" data-action="menu-nav" data-v="help"><span class="ic">🆘</span>${tt("menuHelp")}</div>
      <div class="ditem" data-action="menu-nav" data-v="contact"><span class="ic">✉️</span>${tt("menuContact")}</div>
      <div class="dfoot"><div class="dtoggles">
        <button class="pill" data-action="toggle-lang">🌐 ${tt("langFull")}</button>
        <button class="pill" data-action="toggle-dark">${state.dark?"☀️":"🌙"} ${tt("dark")}</button>
      </div></div>
    </div>`;
}
function openDrawer() { renderDrawer(); const d = $("#drawer"); d.classList.remove("hidden"); enhanceA11y(d); requestAnimationFrame(() => d.classList.add("open")); }
function closeDrawer() { const d = $("#drawer"); d.classList.remove("open"); setTimeout(() => d.classList.add("hidden"), 260); }

/* ============================================================
   NAVIGATION + a11y
   ============================================================ */
const VIEWS = { home: renderHome, topic: renderTopic, search: renderSearch, reader: renderReader, submit: renderSubmit, library: renderLibrary, help: renderHelp, contact: renderContact, auth: renderAuth };

/* Gate: run `action` if signed in + confirmed, else send to sign-in with a resume hint. */
function requireAuth(gateMsg, action) {
  if (state.user && state.user.confirmed) { action(); return; }
  if (gateMsg) toast(gateMsg);
  state.authNext = action;
  state.authMode = "in";
  go("auth");
}
const NAVKEYS = { home: "home", search: "search", library: "library" };
const ROOT_VIEWS = ["home", "search", "library"];
const navStack = [];
function snapshot() { return { view: state.view, readerId: state.readerId, topic: state.topic, searchTopic: state.searchTopic, searchLang: state.searchLang, searchSort: state.searchSort, searchQ: state.searchQ, libTab: state.libTab }; }

const NATIVE_INTERACTIVE = new Set(["BUTTON","A","INPUT","SELECT","TEXTAREA"]);
function a11yLabelFor(action) {
  switch (action) {
    case "open-drawer": return tt("a11yMenu");
    case "back": return tt("a11yBack");
    case "open-submit": return tt("a11yWrite");
    case "toggle-lang": return tt("a11yLang");
    case "toggle-dark": return state.dark ? tt("a11yLight") : tt("a11yDark");
    case "send-comment": return tt("a11ySend");
    default: return null;
  }
}
function enhanceA11y(root) {
  if (!root) return;
  root.querySelectorAll("[data-action]").forEach(el => {
    if (!NATIVE_INTERACTIVE.has(el.tagName)) {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      if (!el.hasAttribute("role")) el.setAttribute("role", "button");
    }
    if (!el.hasAttribute("aria-label")) {
      const lbl = a11yLabelFor(el.dataset.action);
      const hasText = el.textContent && el.textContent.replace(/\s/g, "").length > 2;
      if (lbl && !hasText) el.setAttribute("aria-label", lbl);
    }
  });
}
(function () {
  const target = document.getElementById("screen");
  if (!target || typeof MutationObserver === "undefined") return;
  new MutationObserver(muts => {
    for (const m of muts) for (const node of m.addedNodes) if (node.nodeType === 1) enhanceA11y(node.parentNode || node);
  }).observe(target, { childList: true, subtree: true });
})();

function paint(view) {
  state.view = view;
  const r = VIEWS[view]; if (r) r();
  const showNav = ROOT_VIEWS.includes(view);
  $("#nav").classList.toggle("hidden", !showNav);
  $("#fab").classList.toggle("hidden", view !== "home");
  document.querySelectorAll(".nitem").forEach(b => { const k = b.dataset.action.replace("nav-", ""); b.classList.toggle("on", NAVKEYS[k] === view); });
  scrollEl().scrollTop = 0;
}
let booted = false;
function go(view, extra) {
  if (state.view) { navStack.push(snapshot()); if (navStack.length > 50) navStack.shift(); }
  if (ROOT_VIEWS.includes(view)) navStack.length = 0;
  if (extra) Object.assign(state, extra);
  paint(view);
  // mirror each in-app navigation as a browser history entry, so the phone's
  // hardware Back button walks back through the app instead of closing it
  if (booted) { try { history.pushState({ qh: true }, ""); } catch (e) {} }
}
function back() {
  // triggers the browser's history back; the popstate handler does the actual work
  try { history.back(); } catch (e) { backNav(); }
}
// step one screen back within the app (no history manipulation)
function backNav() {
  const prev = navStack.pop();
  if (!prev) { paint("home"); return; }
  Object.assign(state, prev);
  paint(prev.view);
}
/* Hardware / browser Back button.
   Priority: close an open modal → close the drawer → step back one screen.
   We re-push a state each time so there's always an entry to consume, meaning
   the app only actually leaves (closes) when the user is on a root screen with
   nothing open — matching normal Android app behaviour. */
window.addEventListener("popstate", () => {
  const m = $("#modal");
  if (m && !m.classList.contains("hidden")) { closeModal(); history.pushState({ qh: true }, ""); return; }
  const d = $("#drawer");
  if (d && d.classList.contains("open")) { closeDrawer(); history.pushState({ qh: true }, ""); return; }
  if (navStack.length) { backNav(); history.pushState({ qh: true }, ""); return; }
  // nothing left in-app: if not on home, go home and stay; else allow exit
  if (state.view !== "home") { paint("home"); history.pushState({ qh: true }, ""); }
  // else: let the navigation proceed (leaves the app) — expected on home screen
});
function rerender() { if (VIEWS[state.view]) VIEWS[state.view](); }
/* Re-fetch + re-render the current view (used by pull-to-refresh). Also refreshes
   the signed-in state so account changes show up. */
async function refreshView() {
  try { await refreshUser(); } catch (e) {}
  rerender();
}
function applyDark() { $("#screen").setAttribute("data-theme", state.dark ? "dark" : "light"); }

/* ---------- toast + modal ---------- */
let toastTimer = null;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600); }
function openModal(html) {
  const m = $("#modal"); m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
  m.innerHTML = `<div class="mbox">${html}</div>`; m.classList.remove("hidden"); enhanceA11y(m);
  const f = m.querySelector("input, button, [tabindex]"); if (f) setTimeout(() => f.focus(), 50);
}
function closeModal() { $("#modal").classList.add("hidden"); }
function getCommentName() { return state.guestName || ""; }

/* ============================================================
   EVENTS
   ============================================================ */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case "nav-home": go("home"); break;
    case "nav-search": go("search"); break;
    case "nav-library": go("library"); break;
    case "open-story": go("reader", { readerId: +el.dataset.id }); break;
    case "open-submit": closeDrawer(); requireAuth(tt("gateSubmit"), () => go("submit")); break;
    case "open-drawer": openDrawer(); break;
    case "close-drawer": closeDrawer(); break;
    case "menu-nav": closeDrawer(); setTimeout(() => go(el.dataset.v), 120); break;
    case "menu-topic": closeDrawer(); setTimeout(() => go("topic", { topic: el.dataset.t }), 120); break;
    case "open-topic": go("topic", { topic: el.dataset.t }); break;
    case "back": back(); break;
    case "stopic": state.searchTopic = el.dataset.t; renderSearch(); break;
    case "slang": state.searchLang = el.dataset.v; renderSearch(); break;
    case "sort": state.searchSort = el.value; renderResults(); break;
    case "libtab": state.libTab = el.dataset.v; renderLibrary(); break;
    case "toggle-lang": state.lang = state.lang === "en" ? "sw" : "en"; lsSet("qh.lang", state.lang); rerender(); closeDrawer(); break;
    case "toggle-dark": state.dark = !state.dark; lsSet("qh.dark", state.dark); applyDark(); rerender(); break;
    case "toggle-save": {
      requireAuth(tt("gateSave"), () => {
        const id = state.readerId;
        if (state.saved.includes(id)) { state.saved = state.saved.filter(x => x !== id); toast(tt("toastRemoved")); }
        else { state.saved.push(id); toast(tt("toastSaved")); }
        lsSet("qh.saved", state.saved); renderReader();
      });
      break;
    }
    case "creact": {
      const cid = +el.dataset.cid, typ = el.dataset.type;
      try {
        // server enforces one reaction per device per comment (toggle / switch)
        await api.post(`/api/comments/${cid}/react`, { type: typ, deviceId: deviceId() });
        toast(tt("toastReacted")); renderReader();
      } catch (err) { toast("⚠️ " + err.message); }
      break;
    }
    case "report": {
      const cid = +el.dataset.cid;
      requireAuth(tt("gateReport"), () => {
        const reasons = [1,2,3,4,5].map(i => `<button class="abtn" style="margin:0 0 8px;width:100%" data-action="report-send" data-r="${tt("reportReason"+i)}" data-cid="${cid}">${tt("reportReason"+i)}</button>`).join("");
        openModal(`<h3>${tt("reportPh")}</h3>${reasons}`);
      });
      break;
    }
    case "report-send": {
      try { await api.post(`/api/comments/${+el.dataset.cid}/report`, { reason: el.dataset.r, deviceId: deviceId() }); closeModal(); toast(tt("toastReported")); }
      catch (err) { toast("⚠️ " + err.message); }
      break;
    }
    case "send-comment": {
      const ta = $("#comtext"); const val = (ta && ta.value || "").trim();
      if (!val) { toast("✋"); break; }
      const name = getCommentName();
      if (!name) {
        state.pendingComment = val;
        openModal(`<h3>${tt("needNick")}</h3><div class="field"><label>${tt("nickPh")}</label><input id="nickinput" placeholder="e.g. Polepole"></div><button class="btn primary" data-action="nick-ok">${tt("nickBtn")}</button>`);
        break;
      }
      await postComment(name, val); break;
    }
    case "nick-ok": {
      const n = (($("#nickinput") || {}).value || "").trim();
      if (!n) { toast("✋"); break; }
      state.guestName = n; lsSet("qh.guestName", n); closeModal();
      if (state.pendingComment) { await postComment(n, state.pendingComment); state.pendingComment = null; }
      toast(tt("toastNick")); break;
    }
    case "submit-story": {
      const g = id => ($("#" + id) || {}).value || "";
      const title = g("sub-title"), body = g("sub-body"), pen = g("sub-pen"), contact = g("sub-contact");
      const topic = g("sub-topic") || "life", lang = g("sub-lang") || "en";
      if (!title || !body || !pen) { toast("✋"); break; }
      try {
        await api.post("/api/stories", { title, body, pen, contact, topic, lang, deviceId: deviceId() });
        toast(tt("toastSent"));
        scrollEl().innerHTML = `<div class="view" style="padding-bottom:60px">
          <div class="backbar"><button class="back" data-action="back">←</button><div class="backtitle">${tt("submitTitle")}</div></div>
          <div class="success"><div class="big">📮</div><h3>${tt("subSent")}</h3>
            <p class="muted small" style="line-height:1.7;max-width:280px;margin:0 auto 18px">“${esc(title)}” — ${tt("subSentBody")}</p>
            <span class="status pending">${tt("subStatus")}</span>
            <div style="margin-top:22px"><button class="btn primary" data-action="nav-home">🏠 ${tt("nav.home")}</button></div></div></div>`;
      } catch (err) { toast("⚠️ " + err.message); }
      break;
    }
    case "contact-send": {
      const g = id => (($("#" + id) || {}).value || "").trim();
      const name = g("ct-name"), from = g("ct-email"), subject = g("ct-subject"), msg = g("ct-msg");
      if (!subject || !msg) { toast("✋"); break; }
      const bodyLines = [msg, "", "—", name ? "From: " + name : "", from ? "Reply to: " + from : ""].filter(Boolean);
      const href = "mailto:" + CONTACT.email +
        "?subject=" + encodeURIComponent("[Quietly Here] " + subject) +
        "&body=" + encodeURIComponent(bodyLines.join("\n"));
      window.location.href = href;
      toast(tt("toastSent"));
      break;
    }
    case "auth-tab": state.authMode = el.dataset.v; renderAuth(); break;
    case "goto-signin": state.authMode = "in"; go("auth"); break;
    case "do-signup": {
      const g = id => (($("#" + id) || {}).value || "").trim();
      const name = g("au-name"), email = g("au-email"), pass = ($("#au-pass")||{}).value || "";
      if (!name || !email || !pass) { toast("✋"); break; }
      try {
        const r = await api.post("/api/auth/signup", { name, email, password: pass });
        renderCheckEmail(email);
      } catch (err) { toast("⚠️ " + err.message); }
      break;
    }
    case "do-login": {
      const email = (($("#au-email")||{}).value || "").trim(), pass = ($("#au-pass")||{}).value || "";
      if (!email || !pass) { toast("✋"); break; }
      try {
        const r = await api.post("/api/auth/login", { email, password: pass });
        state.user = r.user;
        toast(tt("authDone"));
        resumeAfterAuth();
      } catch (err) {
        if (err.needConfirm) { renderCheckEmail(email); }
        else toast("⚠️ " + err.message);
      }
      break;
    }
    case "resend-confirm": {
      try { await api.post("/api/auth/resend", { email: el.dataset.email }); toast(tt("resent")); }
      catch (err) { toast("⚠️ " + err.message); }
      break;
    }
    case "sign-out": {
      try { await api.post("/api/auth/logout", {}); } catch (e) {}
      state.user = null;
      // saved list is device-local; keep it but it will re-gate on next save
      toast(tt("toastSignOut")); renderLibrary(); break;
    }
    case "goto-auth": state.authMode = "in"; go("auth"); break;
    case "menu-auth": closeDrawer(); state.authMode = "in"; setTimeout(() => go("auth"), 120); break;
    case "menu-signout": {
      closeDrawer();
      try { await api.post("/api/auth/logout", {}); } catch (e) {}
      state.user = null;
      toast(tt("toastSignOut")); rerender(); break;
    }
    case "use-recent": state.searchQ = el.dataset.q; renderSearch(); break;
    case "delete-data":
      state.saved = []; state.reactedComments = {}; state.progress = {}; state.guestName = "";
      ["qh.saved","qh.reactedComments","qh.progress","qh.guestName"].forEach(k => lsSet(k, k==="qh.guestName"?"":(k==="qh.reactedComments"||k==="qh.progress"?{}:[])));
      toast(tt("toastDelete")); go("library"); break;
  }
});

/* After a successful sign-in, resume the pending gated action (or go home). */
function resumeAfterAuth() {
  const next = state.authNext;
  state.authNext = null;
  // drop the auth screen from the back stack so Back doesn't return to it
  if (state.view === "auth") { const p = navStack.pop(); if (p && p.view !== "auth") { Object.assign(state, p); } }
  if (typeof next === "function") { next(); }
  else { paint(state.view === "auth" ? "home" : state.view); }
}

async function refreshUser() {
  try { const r = await api.get("/api/auth/me"); state.user = r.user; } catch (e) { state.user = null; }
}

async function postComment(name, text) {
  try {
    const r = await api.post(`/api/stories/${state.readerId}/comments`, { name, text, deviceId: deviceId() });
    renderReader();
  } catch (err) { toast("⚠️ " + err.message); }
}

document.addEventListener("input", e => {
  if (e.target && e.target.id === "searchinput") { state.searchQ = e.target.value; clearTimeout(window.__st); window.__st = setTimeout(renderResults, 200); }
});
document.addEventListener("keydown", e => {
  if (e.target && e.target.id === "searchinput" && e.key === "Enter") {
    const q = e.target.value.trim();
    if (q) { state.recents = [q, ...state.recents.filter(x => x !== q)].slice(0, 5); lsSet("qh.recents", state.recents); }
    renderResults(); return;
  }
  if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
    const el = e.target.closest && e.target.closest("[data-action]");
    if (el && !NATIVE_INTERACTIVE.has(el.tagName)) { e.preventDefault(); el.click(); }
    return;
  }
  if (e.key === "Escape") {
    const m = $("#modal"); if (m && !m.classList.contains("hidden")) return closeModal();
    const d = $("#drawer"); if (d && d.classList.contains("open")) return closeDrawer();
  }
});
scrollEl().addEventListener("scroll", () => {
  if (state.view !== "reader") return;
  const el = scrollEl(); const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return;
  state.progress[state.readerId] = Math.min(99, Math.round((el.scrollTop / max) * 100));
  lsSet("qh.progress", state.progress);
}, { passive: true });
document.addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

/* ============================================================
   PULL-TO-REFRESH
   Native-app feel: pull the scroll area down from the top past a
   threshold, release, and the current view re-fetches. A spinner
   indicator follows the pull. Only arms when already scrolled to the top,
   so it never fights normal scrolling. Disabled while a modal/drawer is open.
   ============================================================ */
(function setupPullToRefresh() {
  const el = scrollEl();
  if (!el) return;
  // indicator element (styled inline so it works inside the sandboxed preview too)
  const ind = document.createElement("div");
  ind.id = "ptr";
  ind.setAttribute("aria-hidden", "true");
  ind.innerHTML = `<div class="ptr-spin"></div>`;
  Object.assign(ind.style, {
    position: "absolute", top: "0", left: "50%", transform: "translate(-50%,-46px)",
    width: "34px", height: "34px", borderRadius: "50%",
    background: "var(--surface,#FFFDF8)", boxShadow: "0 4px 14px rgba(30,40,33,.18)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: "40", opacity: "0", transition: "opacity .15s", pointerEvents: "none"
  });
  // spinner style (injected once)
  const st = document.createElement("style");
  st.textContent = `
    #ptr .ptr-spin{width:18px;height:18px;border-radius:50%;border:2.5px solid var(--line,#E5DCC9);border-top-color:var(--teal,#155E5A);transition:transform .1s linear}
    #ptr.spinning .ptr-spin{animation:ptrspin .7s linear infinite}
    @keyframes ptrspin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(st);
  const screen = document.getElementById("screen");
  (screen || el.parentNode).appendChild(ind);

  const THRESHOLD = 70;   // px pull needed to trigger
  const MAX = 110;        // px cap on how far the indicator travels
  let startY = 0, pulling = false, dist = 0, refreshing = false;

  const overlayOpen = () => {
    const m = $("#modal"), d = $("#drawer");
    return (m && !m.classList.contains("hidden")) || (d && d.classList.contains("open"));
  };

  el.addEventListener("touchstart", (e) => {
    if (refreshing || overlayOpen()) return;
    if (el.scrollTop > 0) { pulling = false; return; }
    startY = e.touches[0].clientY; pulling = true; dist = 0;
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (!pulling || refreshing) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0) { pulling = false; ind.style.opacity = "0"; ind.style.transform = "translate(-50%,-46px)"; return; }
    // We're pulling down from the very top: take over from the browser's own
    // pull gesture so the page can't rubber-band / hide the header.
    if (el.scrollTop <= 0 && e.cancelable) e.preventDefault();
    // resistance curve so it feels rubbery
    const pull = Math.min(MAX, dist * 0.5);
    ind.style.transition = "none";
    ind.style.opacity = String(Math.min(1, pull / THRESHOLD));
    ind.style.transform = `translate(-50%,${pull - 46}px)`;
    ind.querySelector(".ptr-spin").style.transform = `rotate(${pull * 3}deg)`;
  }, { passive: false });

  el.addEventListener("touchend", async () => {
    if (!pulling || refreshing) { pulling = false; return; }
    pulling = false;
    const pull = Math.min(MAX, dist * 0.5);
    ind.style.transition = "transform .2s, opacity .2s";
    if (pull >= THRESHOLD) {
      refreshing = true;
      ind.classList.add("spinning");
      ind.style.transform = "translate(-50%,14px)";
      ind.style.opacity = "1";
      try { await refreshView(); } catch (e) {}
      // brief pause so the spin is perceptible, then retract
      setTimeout(() => {
        ind.classList.remove("spinning");
        ind.style.transform = "translate(-50%,-46px)";
        ind.style.opacity = "0";
        refreshing = false;
      }, 350);
    } else {
      ind.style.transform = "translate(-50%,-46px)";
      ind.style.opacity = "0";
    }
  });
})();

/* ---------- boot ---------- */
applyDark();
// seed two history entries: the first is the "exit" backstop, the second is what
// the app consumes on Back. This lets the hardware Back button navigate in-app.
try { history.replaceState({ qh: "root" }, ""); history.pushState({ qh: true }, ""); } catch (e) {}
booted = true;
go("home");
// load any existing session, then refresh the current view so account UI shows
refreshUser().then(() => { if (state.user) rerender(); });
