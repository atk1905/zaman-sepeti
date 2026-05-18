const STORAGE_KEY = 'zaman-sepeti-state-v1';
const VIEW_KEY = 'zaman-sepeti-view-v1';

const categories = [
  { slug: 'temizlik', label: 'Temizlik', count: 128 },
  { slug: 'tamir', label: 'Tamir', count: 94 },
  { slug: 'egitim', label: 'Eğitim', count: 77 },
  { slug: 'tasarim', label: 'Tasarım', count: 58 },
  { slug: 'yazilim', label: 'Yazılım', count: 41 },
  { slug: 'nakliye', label: 'Nakliye', count: 63 },
];

const cities = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Online'];

const aiTools = [
  {
    key: 'chatgpt',
    name: 'ChatGPT',
    role: 'PRD / akış / acceptance',
    purpose: 'Ürün kararları, kullanıcı akışları ve teslim kriterleri.',
    prompt: 'Zaman Sepeti için akışları çıkar: talep açma, teklif toplama, teklif kabulü, kabul sonrası sohbet kilidi ve 7 günlük kapanma.',
    url: 'https://chatgpt.com/',
  },
  {
    key: 'gemini',
    name: 'Gemini',
    role: 'Araştırma / risk',
    purpose: 'Pazar araştırması, rakip analizi ve teknik risk özeti.',
    prompt: 'Talep odaklı marketplace için rakipleri, olası riskleri ve MVP fırsatlarını kısa maddelerle özetle.',
    url: 'https://gemini.google.com/',
  },
  {
    key: 'claude',
    name: 'Claude',
    role: 'Mimari / review',
    purpose: 'Kod inceleme, refactor ve mimari denge.',
    prompt: 'Tek sayfa marketplace kodunu incele; admin panel, settings ve state yönetimi için güvenli bir refactor planı çıkar.',
    url: 'https://claude.ai/',
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    role: 'Backend / DB',
    purpose: 'Supabase, SQL, şema ve performans analizi.',
    prompt: 'Supabase şemasını, RLS kurallarını ve live-mode veri akışını değerlendir; eksik noktaları öner.',
    url: 'https://chat.deepseek.com/',
  },
  {
    key: 'qwen',
    name: 'Qwen',
    role: 'Patch / helper',
    purpose: 'Küçük patch’ler, regex, utility kodu.',
    prompt: 'Bir frontend statik uygulamasına ayar paneli ve temiz event binding eklemek için kısa patch önerileri üret.',
    url: 'https://chat.qwen.ai/',
  },
  {
    key: 'lovable',
    name: 'Lovable',
    role: 'UI prototip',
    purpose: 'Ekran akışı, layout ve responsive düzen.',
    prompt: 'Zaman Sepeti için admin panel, arkaplan ayarları ve AI çalışma masası olan modern bir arayüz öner.',
    url: 'https://lovable.dev/',
  },
];

const DEFAULT_SETTINGS = {
  accentHue: 262,
  orb1Opacity: 0.48,
  orb2Opacity: 0.22,
  gridOpacity: 0.025,
  glassBlur: 22,
  defaultView: 'home',
};

const appConfig = window.ZS_CONFIG || {};
const adminEmails = new Set((appConfig.adminEmails || ['atakan21ai@gmail.com']).map((email) => String(email).toLowerCase()));
const hasSupabaseConfig = Boolean(appConfig.supabaseUrl && appConfig.supabaseAnonKey && window.supabase);
let supabaseClient = null;
let authUser = null;
let liveMode = false;
let categoryIdBySlug = new Map();
let currentProfile = null;
let isAdminUser = false;

const fmtMoney = (value) => new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 0,
}).format(value || 0);

const fmtDate = (iso) => new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(iso));

const uid = () => `zs_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const hoursFromNow = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

function createListingDeadline(urgency = '7 gün') {
  if (urgency === 'Bugün Bitsin') return hoursFromNow(24);
  if (urgency === '24 saat') return hoursFromNow(24);
  if (urgency === '3 gün') return daysFromNow(3);
  return daysFromNow(7);
}

function recomputeAdminAccess() {
  const email = String(authUser?.email || '').toLowerCase();
  const role = String(currentProfile?.role || '').toLowerCase();
  isAdminUser = Boolean(email && adminEmails.has(email)) || role === 'admin';
  if (!isAdminUser && state?.view === 'admin') {
    state.view = state.settings?.defaultView || 'home';
  }
}

function ensureSupabaseClient() {
  if (!hasSupabaseConfig) return null;
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return supabaseClient;
}

async function initLiveBackend() {
  const client = ensureSupabaseClient();
  if (!client) return false;

  const { data } = await client.auth.getSession();
  authUser = data?.session?.user || null;
  client.auth.onAuthStateChange(async (_event, session) => {
    authUser = session?.user || null;
    currentProfile = null;
    recomputeAdminAccess();
    await refreshFromSupabase();
    renderView();
  });

  liveMode = true;
  await refreshFromSupabase();
  return true;
}

function mapLiveListings(rows, offersRows, conversationsRows, messagesRows, profilesById) {
  const offersByListing = new Map();
  (offersRows || []).forEach((offer) => {
    const mapped = {
      id: offer.id,
      provider: profilesById.get(offer.sender_id)?.display_name || 'Doğrulanmış kullanıcı',
      amount: Number(offer.price || 0),
      delivery: offer.eta || 'Belirtilmedi',
      message: offer.message,
      createdAt: offer.created_at,
      status: offer.status,
    };
    if (!offersByListing.has(offer.listing_id)) offersByListing.set(offer.listing_id, []);
    offersByListing.get(offer.listing_id).push(mapped);
  });

  const conversationByListing = new Map();
  (conversationsRows || []).forEach((conversation) => {
    conversationByListing.set(conversation.listing_id, conversation);
  });

  return (rows || []).map((listing) => {
    const relatedOffers = (offersByListing.get(listing.id) || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const conversation = conversationByListing.get(listing.id);
    const messages = conversation ? (messagesRows || []).filter((msg) => msg.conversation_id === conversation.id).map((msg) => ({
      sender: profilesById.get(msg.sender_id)?.display_name || 'Kullanıcı',
      body: msg.body,
      createdAt: msg.created_at,
    })) : [];

    return {
      id: listing.id,
      title: listing.title,
      category: listing.category_slug || listing.category_id,
      city: listing.city || 'Online',
      budgetMin: Number(listing.budget_min || 0),
      budgetMax: Number(listing.budget_max || 0),
      urgency: listing.urgency || '7 gün',
      status: listing.status,
      owner: profilesById.get(listing.owner_id)?.display_name || 'Talep sahibi',
      provider: relatedOffers[0]?.provider || 'Henüz teklif yok',
      providerCount: relatedOffers.length || 1,
      createdAt: listing.created_at,
      deadline: listing.expires_at,
      tags: [listing.urgency || '7 gün'],
      description: listing.description,
      offers: relatedOffers,
      acceptedOfferId: listing.accepted_offer_id,
      conversationId: conversation?.id || null,
      conversation: messages,
    };
  });
}

async function refreshFromSupabase() {
  const client = ensureSupabaseClient();
  if (!client) return false;

  const [
    { data: categoryRows },
    { data: listingRows },
    { data: offerRows },
    { data: conversationRows },
    { data: messageRows },
    currentProfileResult,
  ] = await Promise.all([
    client.from('categories').select('id, name, slug, sort_order'),
    client.from('listings').select('id, owner_id, title, description, category_id, city, budget_min, budget_max, status, urgency, expires_at, accepted_offer_id, offer_count, created_at'),
    client.from('offers').select('id, listing_id, sender_id, price, eta, message, status, created_at'),
    client.from('conversations').select('id, listing_id, offer_id, buyer_id, provider_id, last_message_at, created_at'),
    client.from('messages').select('id, conversation_id, sender_id, body, created_at'),
    authUser
      ? client.from('profiles').select('id, display_name, city, avatar_url, role, is_verified').eq('id', authUser.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  categoryIdBySlug = new Map((categoryRows || []).map((category) => [category.slug, category.id]));

  const profileIds = new Set();
  (listingRows || []).forEach((row) => profileIds.add(row.owner_id));
  (offerRows || []).forEach((row) => profileIds.add(row.sender_id));
  (conversationRows || []).forEach((row) => {
    profileIds.add(row.buyer_id);
    profileIds.add(row.provider_id);
  });
  (messageRows || []).forEach((row) => profileIds.add(row.sender_id));

  const { data: profiles } = profileIds.size
    ? await client.from('profiles').select('id, display_name, city, avatar_url, role').in('id', [...profileIds])
    : { data: [] };

  const categoriesById = new Map((categoryRows || []).map((category) => [category.id, category]));
  const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  if (currentProfileResult?.data) {
    currentProfile = currentProfileResult.data;
    profilesById.set(currentProfile.id, currentProfile);
  } else {
    currentProfile = null;
  }
  recomputeAdminAccess();
  state.listings = mapLiveListings(listingRows || [], offerRows || [], conversationRows || [], messageRows || [], profilesById)
    .map((listing) => ({
      ...listing,
      category: categoriesById.get(listing.category)?.slug || listing.category,
    }));
  if (!state.selectedListingId && state.listings[0]) state.selectedListingId = state.listings[0].id;
  if (!state.selectedThreadId && state.listings[0]) state.selectedThreadId = state.listings[0].id;
  recomputeAdminAccess();
  persist();
  return true;
}

async function authRequest(run, friendlyError) {
  try {
    return await run();
  } catch (error) {
    console.error(error);
    alert(`${friendlyError}: ${error?.message || 'Bilinmeyen hata'}`);
    return null;
  }
}

const authRedirectUrl = `${window.location.origin}${window.location.pathname}`;

async function signInWithEmailLink(email) {
  const client = ensureSupabaseClient();
  if (!client) return;
  return authRequest(() => client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authRedirectUrl },
  }), 'E-posta bağlantısı gönderilemedi');
}

async function signInWithPassword(email, password) {
  const client = ensureSupabaseClient();
  if (!client) return;
  return authRequest(() => client.auth.signInWithPassword({ email, password }), 'Email girişi başarısız');
}

async function signUpWithEmail(email, password, displayName, city) {
  const client = ensureSupabaseClient();
  if (!client) return;
  return authRequest(() => client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: authRedirectUrl,
      data: { display_name: displayName, full_name: displayName, city },
    },
  }), 'Kayıt başarısız');
}

async function signInWithGoogle() {
  const client = ensureSupabaseClient();
  if (!client) return;
  return authRequest(() => client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: authRedirectUrl },
  }), 'Google girişi başarısız');
}

async function signInWithApple() {
  const client = ensureSupabaseClient();
  if (!client) return;
  return authRequest(() => client.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: authRedirectUrl },
  }), 'Apple girişi başarısız');
}

async function signOut() {
  const client = ensureSupabaseClient();
  if (!client) return;
  return authRequest(() => client.auth.signOut(), 'Çıkış yapılamadı');
}

function createSeedListings() {
  return [
    {
      id: 'l1',
      title: 'Eve tertemiz çıkış: 2+1 daire detaylı temizlik',
      category: 'temizlik',
      city: 'İstanbul',
      budgetMin: 1800,
      budgetMax: 2800,
      urgency: '24 saat',
      status: 'active',
      owner: 'Elif K.',
      provider: 'Aylin Temizlik',
      providerCount: 14,
      createdAt: hoursAgo(8),
      deadline: hoursFromNow(62),
      tags: ['Acil', 'Hafta içi', 'Malzeme dahil'],
      description: 'Taşınma öncesi detaylı temizlik istiyorum. Salon, mutfak, iki oda ve iki banyo dahil. En hızlı gelen teklif öncelikli.',
      offers: [
        { id: uid(), provider: 'Aylin Temizlik', amount: 2450, delivery: 'Bugün 18:00', message: 'Ekibim hazır, malzeme bizden.', createdAt: hoursAgo(5), status: 'pending' },
        { id: uid(), provider: 'Mavi Temizlik', amount: 2150, delivery: 'Yarın sabah', message: 'Hızlı çıkış yapabiliriz.', createdAt: hoursAgo(3), status: 'pending' },
      ],
      acceptedOfferId: null,
      conversation: [],
    },
    {
      id: 'l2',
      title: 'Kombi bakımı ve peteklerin havası alınacak',
      category: 'tamir',
      city: 'Ankara',
      budgetMin: 1200,
      budgetMax: 2000,
      urgency: 'Bugün Bitsin',
      status: 'active',
      owner: 'Mert A.',
      provider: 'Teknik Usta',
      providerCount: 8,
      createdAt: hoursAgo(18),
      deadline: hoursFromNow(47),
      tags: ['Bugün Bitsin', 'Yerinde servis', 'Faturalı'],
      description: 'Kombi bakımına ek peteklerde ısınma kontrolü lazım. Akşam saatleri uygundur.',
      offers: [
        { id: uid(), provider: 'Teknik Usta', amount: 1500, delivery: 'Bu akşam', message: 'Yedek parça gerekirse önceden bildiririm.', createdAt: hoursAgo(2), status: 'pending' },
      ],
      acceptedOfferId: null,
      conversation: [],
    },
    {
      id: 'l3',
      title: 'İlkokul öğrencisi için haftalık İngilizce desteği',
      category: 'egitim',
      city: 'Online',
      budgetMin: 1600,
      budgetMax: 2600,
      urgency: '3 gün',
      status: 'accepted',
      owner: 'Seda T.',
      provider: 'Nehir Öğretmen',
      providerCount: 26,
      createdAt: hoursAgo(50),
      deadline: hoursFromNow(128),
      tags: ['Online', 'Haftada 2 gün', 'Referanslı'],
      description: 'Çocuğum için eğlenceli ve düzenli bir İngilizce çalışma desteği arıyoruz. Referans önemlidir.',
      offers: [
        { id: uid(), provider: 'Nehir Öğretmen', amount: 2200, delivery: 'Haftaya başlayabilir', message: 'Çocuk odaklı, oyunlaştırılmış yöntemler kullanıyorum.', createdAt: hoursAgo(42), status: 'accepted' },
        { id: uid(), provider: 'DilAtölye', amount: 1800, delivery: 'Pazartesi', message: 'Kısa haftalık program çıkarırım.', createdAt: hoursAgo(38), status: 'rejected' },
      ],
      acceptedOfferId: null,
      conversation: [
        { sender: 'Seda T.', body: 'Merhaba, kabul ettik. Haftanın günlerini planlayalım mı?', createdAt: hoursAgo(6) },
        { sender: 'Nehir Öğretmen', body: 'Tabii, size uygun saatleri gönderiyorum. Çocuğun seviyesini de konuşalım.', createdAt: hoursAgo(5) },
      ],
    },
    {
      id: 'l4',
      title: 'Logo + sosyal medya kimliği: yeni kafe için hızlı tasarım',
      category: 'tasarim',
      city: 'İzmir',
      budgetMin: 5000,
      budgetMax: 8500,
      urgency: '24 saat',
      status: 'active',
      owner: 'Bora E.',
      provider: 'Pixel Loft',
      providerCount: 19,
      createdAt: hoursAgo(4),
      deadline: hoursFromNow(160),
      tags: ['Branding', 'Logo', 'Instagram kit'],
      description: 'Yeni açılacak kafe için logo, renk paleti ve 6 postluk sosyal medya şablonu istiyorum.',
      offers: [
        { id: uid(), provider: 'Pixel Loft', amount: 6400, delivery: '3 gün', message: 'Kurumsal ve sıcak bir çizgi öneriyorum.', createdAt: hoursAgo(1), status: 'pending' },
      ],
      acceptedOfferId: null,
      conversation: [],
    },
    {
      id: 'l5',
      title: 'Next.js ile hafif yönetim paneli geliştirme',
      category: 'yazilim',
      city: 'Online',
      budgetMin: 12000,
      budgetMax: 18000,
      urgency: '3 gün',
      status: 'active',
      owner: 'Deniz S.',
      provider: 'StackFlow',
      providerCount: 12,
      createdAt: hoursAgo(20),
      deadline: hoursFromNow(96),
      tags: ['TypeScript', 'Supabase', 'Admin panel'],
      description: 'Basit ama temiz bir yönetim paneli. Auth, tablo görünümü ve birkaç rapor kartı yeterli.',
      offers: [
        { id: uid(), provider: 'StackFlow', amount: 14500, delivery: '1 hafta', message: 'Tailwind + Supabase ile hızlı çıkarırım.', createdAt: hoursAgo(9), status: 'pending' },
        { id: uid(), provider: 'Qubit Studio', amount: 16800, delivery: '8 gün', message: 'Test ve deploy dahil teklif.', createdAt: hoursAgo(4), status: 'pending' },
      ],
      acceptedOfferId: null,
      conversation: [],
    },
    {
      id: 'l6',
      title: 'Parça eşya için aynı gün şehir içi taşıma',
      category: 'nakliye',
      city: 'Bursa',
      budgetMin: 900,
      budgetMax: 1600,
      urgency: 'Bugün Bitsin',
      status: 'expired',
      owner: 'Can Y.',
      provider: 'Hızlı Nakliye',
      providerCount: 7,
      createdAt: hoursAgo(170),
      deadline: hoursAgo(2),
      tags: ['Aynı gün', 'Asansör yok', 'İki kişi'],
      description: 'Küçük dolap, masa ve birkaç koli taşınacak. Öğleden önce alınabilir.',
      offers: [
        { id: uid(), provider: 'Hızlı Nakliye', amount: 1250, delivery: 'Bugün 15:00', message: '2 kişi + araç hazır.', createdAt: hoursAgo(30), status: 'pending' },
      ],
      acceptedOfferId: null,
      conversation: [],
    },
  ];
}

function seedState() {
  return {
    view: 'home',
    filterCategory: 'all',
    filterCity: 'all',
    filterBudget: 'all',
    selectedListingId: 'l3',
    selectedThreadId: 'l3',
    listings: createSeedListings(),
    settings: { ...DEFAULT_SETTINGS },
  };
}

function loadState() {
  const base = seedState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const savedView = localStorage.getItem(VIEW_KEY);
    if (saved && Array.isArray(saved.listings)) {
      base.settings = { ...base.settings, ...(saved.settings || {}) };
      base.view = savedView || saved.view || base.settings.defaultView || base.view;
      base.filterCategory = saved.filterCategory || base.filterCategory;
      base.filterCity = saved.filterCity || base.filterCity;
      base.filterBudget = saved.filterBudget || base.filterBudget;
      base.selectedListingId = saved.selectedListingId || base.selectedListingId;
      base.selectedThreadId = saved.selectedThreadId || base.selectedThreadId;
      base.listings = saved.listings;
    }
  } catch (error) {
    console.warn('State load failed', error);
  }
  return base;
}

let state = loadState();
const app = document.getElementById('app');

function applyTheme() {
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const root = document.documentElement;
  root.style.setProperty('--accent-hue', String(state.settings.accentHue));
  root.style.setProperty('--orb-1-opacity', String(state.settings.orb1Opacity));
  root.style.setProperty('--orb-2-opacity', String(state.settings.orb2Opacity));
  root.style.setProperty('--grid-opacity', String(state.settings.gridOpacity));
  root.style.setProperty('--glass-blur', `${state.settings.glassBlur}px`);
  if (app) app.dataset.density = state.settings.defaultView === 'compact' ? 'compact' : 'normal';
}

applyTheme();

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(VIEW_KEY, state.view);
}

function remainingParts(deadline) {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { expired: true, text: 'Süresi doldu' };
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    expired: false,
    text: `${days}g ${hours}s ${minutes}d ${seconds}sn`,
    short: `${days > 0 ? `${days} gün ` : ''}${hours} saat ${minutes} dk`,
  };
}

function updateStatuses() {
  let changed = false;
  state.listings = state.listings.map((listing) => {
    if (listing.status === 'active' && new Date(listing.deadline).getTime() <= Date.now()) {
      changed = true;
      return { ...listing, status: 'expired' };
    }
    return listing;
  });
  if (changed) persist();
}

function visibleListings() {
  return state.listings.filter((listing) => {
    const categoryMatch = state.filterCategory === 'all' || listing.category === state.filterCategory;
    const cityMatch = state.filterCity === 'all' || listing.city === state.filterCity;
    const budget = Number(state.filterBudget);
    const budgetMatch = state.filterBudget === 'all' || (listing.budgetMin <= budget && listing.budgetMax >= budget);
    return categoryMatch && cityMatch && budgetMatch;
  });
}

function sortedFeatured() {
  return [...state.listings]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 3);
}

function selectedListing() {
  return state.listings.find((item) => item.id === state.selectedListingId) || state.listings[0];
}

function acceptedThreads() {
  return state.listings.filter((item) => item.status === 'accepted' || item.conversation.length);
}

function urgencyBadge(listing) {
  if (listing.status === 'expired') return '<span class="badge expired">Süresi doldu</span>';
  if (listing.status === 'accepted') return '<span class="badge accepted">Teklif kabul edildi</span>';
  if (listing.urgency === 'Bugün Bitsin') return '<span class="badge hot">Bugün Bitsin</span>';
  if (listing.urgency === '24 saat') return '<span class="badge hot">24 Saat</span>';
  return '<span class="badge time">7 gün canlı</span>';
}

function categoryLabel(slug) {
  return categories.find((c) => c.slug === slug)?.label || slug;
}

function navButton(label, view) {
  const active = state.view === view ? 'active' : '';
  return `<button class="${active}" data-view="${view}">${label}</button>`;
}

function renderTopbar() {
  const activeCount = state.listings.filter((item) => item.status === 'active').length;
  const acceptedCount = state.listings.filter((item) => item.status === 'accepted').length;
  const settingLabel = `Tema ${Math.round(state.settings?.accentHue ?? DEFAULT_SETTINGS.accentHue)}°`;
  const authLabel = liveMode
    ? (authUser?.email ? `Canlı: ${authUser.email}` : 'Canlı veri hazır')
    : 'Demo modu';
  const authActions = liveMode
    ? (authUser
      ? `<button class="secondary" data-auth-action="signout">Çıkış Yap</button>`
      : `<button class="secondary" data-view="auth">Giriş Yap / Kaydol</button>`)
    : `<button class="secondary" data-auth-action="setup">Supabase bağla</button>`;
  const adminNav = isAdminUser ? navButton('Yönetim', 'admin') : '';
  const adminBadge = isAdminUser ? '<span class="pill">Admin yetkisi açık</span>' : '';
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">ZS</div>
        <div>
          <h1>Zaman Sepeti</h1>
          <p>Talep odaklı marketplace · 7 gün canlı ilan sistemi</p>
        </div>
      </div>
      <nav class="nav" aria-label="Ana gezinme">
        ${navButton('Ana Sayfa', 'home')}
        ${navButton('İlanlar', 'market')}
        ${navButton('Talep Aç', 'create')}
        ${navButton('Mesajlar', 'messages')}
        ${navButton('Profil', 'profile')}
        ${navButton('Hakkında', 'about')}
        ${adminNav}
      </nav>
      <div class="badge-row">
        <span class="pill">${activeCount} aktif talep</span>
        <span class="pill">${acceptedCount} kapalı sohbet</span>
        <span class="pill">${settingLabel}</span>
        <span class="pill">${authLabel}</span>
        ${adminBadge}
        ${authActions}
      </div>
    </header>
  `;
}

function renderHome() {
  const featured = sortedFeatured();
  const categoryCards = categories.map((cat) => `
    <button class="category-card" data-view="market" data-category="${cat.slug}">
      <span class="count">${cat.count} ilan</span>
      <strong>${cat.label}</strong>
      <span>Talep açanlar için canlı kategori akışı</span>
    </button>
  `).join('');

  return `
    <section class="hero">
      <div>
        <span class="pill">Maya Elektronik Bilişim grup markası</span>
        <h2>İhtiyacını paylaş, teklifler gelsin.<br />En uygunu seç, sohbet sonra açılsın.</h2>
        <p class="lead">
          Zaman Sepeti; zamanı olmayan ama bütçesi olan insanların taleplerini öne çıkaran,
          hizmet verenlerin teklif bıraktığı, süreli ve canlı bir marketplace prototipidir.
        </p>
        <div class="hero-actions">
          <button class="primary" data-view="create">Talep Aç</button>
          <button class="secondary" data-view="market">İlanları İncele</button>
        </div>
      </div>
      <div class="hero-grid">
        <div class="stat">
          <div class="kpi">7 gün</div>
          <div class="label">Her ilan için görünür geri sayım</div>
          <div class="sub">Süre bitince talep otomatik kapanır.</div>
        </div>
        <div class="stat">
          <div class="kpi">2 taraf</div>
          <div class="label">Talep sahibi + çözüm veren</div>
          <div class="sub">Önce teklif, sonra iletişim.</div>
        </div>
        <div class="stat">
          <div class="kpi">%100</div>
          <div class="label">Talep öncelikli yapı</div>
          <div class="sub">Armut'tan farklı, ihtiyaç merkezli.</div>
        </div>
        <div class="stat">
          <div class="kpi">Maya</div>
          <div class="label">Kurumsal çatı notu</div>
          <div class="sub">Footer ve legal alanlarda görünür.</div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h3>Kategori grid’i</h3>
          <p>Armut mantığı + sahibinden ilan düzeni + talep-first deneyim.</p>
        </div>
        <button class="secondary" data-view="market">Tüm talepleri gör</button>
      </div>
      <div class="mini-grid">${categoryCards}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h3>Sıcak ilanlar</h3>
          <p>Yeni açılanlar, bitmek üzere olanlar ve kabul edilmiş talepler.</p>
        </div>
      </div>
      <div class="mini-grid">
        ${featured.map(featureCard).join('')}
      </div>
    </section>

    <section class="section section-grid">
      <div class="panel">
        <h4>Nasıl çalışır?</h4>
        <div class="listing-list">
          <div class="offer-item"><strong>1. Talep aç</strong><small>İşini, bütçeni, şehrini ve son tarihini yaz.</small></div>
          <div class="offer-item"><strong>2. Teklif topla</strong><small>Çözüm verenler fiyat, süre ve kısa mesaj bırakır.</small></div>
          <div class="offer-item"><strong>3. Kabul et</strong><small>Seçtiğin teklifle sohbet kanalı açılır.</small></div>
          <div class="offer-item"><strong>4. Süre dolarsa kapanır</strong><small>7 gün sonunda ilan otomatik arşive gider.</small></div>
        </div>
      </div>
      <div class="panel">
        <h4>Para kazanma modeli</h4>
        <div class="listing-list">
          <div class="offer-item"><strong>Öne çıkarma</strong><small>Talep 24 saat üst sırada kalır.</small></div>
          <div class="offer-item"><strong>Aciliyet rozeti</strong><small>Bugün Bitsin / 24 Saat gibi premium ilanlar.</small></div>
          <div class="offer-item"><strong>Doğrulanmış profil</strong><small>Kimlik ve güven rozeti ile abonelik.</small></div>
          <div class="offer-item"><strong>Pro hizmet veren</strong><small>Freelancer ve esnaf için ekstra görünürlük.</small></div>
        </div>
      </div>
    </section>
  `;
}

function featureCard(listing) {
  const remaining = remainingParts(listing.deadline);
  return `
    <article class="category-card listing-card ${state.selectedListingId === listing.id ? 'active' : ''}" data-select-listing="${listing.id}">
      <div class="listing-top">
        ${urgencyBadge(listing)}
        <span class="pill">${categoryLabel(listing.category)}</span>
      </div>
      <strong class="listing-title">${listing.title}</strong>
      <span class="muted">${listing.city} · ${listing.owner}</span>
      <div class="inline-row">
        <span class="listing-price">${fmtMoney(listing.budgetMin)}–${fmtMoney(listing.budgetMax)}</span>
        <span class="pill">${remaining.text}</span>
      </div>
    </article>
  `;
}

function renderMarket() {
  const listings = visibleListings().sort((a, b) => {
    const sortA = a.status === 'active' ? 0 : a.status === 'accepted' ? 1 : 2;
    const sortB = b.status === 'active' ? 0 : b.status === 'accepted' ? 1 : 2;
    return sortA - sortB || new Date(b.createdAt) - new Date(a.createdAt);
  });
  const listing = selectedListing();
  const offers = listing?.offers || [];
  const remaining = listing ? remainingParts(listing.deadline) : null;
  const offerList = offers.length
    ? offers.map((offer) => `
      <div class="offer-item">
        <div class="offer-row">
          <strong>${offer.provider}</strong>
          <span class="pill">${fmtMoney(offer.amount)}</span>
        </div>
        <small>${offer.delivery} · ${fmtDate(offer.createdAt)}</small>
        <p class="muted" style="margin:8px 0 0">${offer.message}</p>
        ${listing.status === 'active' ? `<button class="secondary" data-accept-offer="${listing.id}" data-offer-id="${offer.id}">Teklifi kabul et</button>` : ''}
      </div>
    `).join('')
    : '<div class="empty">Henüz teklif yok. İlk teklifi bırak.</div>';

  return `
    <section class="section">
      <div class="section-head">
        <div>
          <h3>İlan listesi</h3>
          <p>Kategori, şehir ve bütçe filtreleriyle talep akışını tarayın.</p>
        </div>
        <button class="primary" data-view="create">Yeni talep aç</button>
      </div>
      <div class="filters">
        <select id="filter-category">
          <option value="all">Tüm kategoriler</option>
          ${categories.map((c) => `<option value="${c.slug}" ${state.filterCategory === c.slug ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
        <select id="filter-city">
          <option value="all">Tüm şehirler</option>
          ${cities.map((city) => `<option value="${city}" ${state.filterCity === city ? 'selected' : ''}>${city}</option>`).join('')}
        </select>
        <select id="filter-budget">
          <option value="all">Bütçe aralığı</option>
          <option value="1500" ${state.filterBudget === '1500' ? 'selected' : ''}>0–1.500 TL</option>
          <option value="4000" ${state.filterBudget === '4000' ? 'selected' : ''}>1.500–4.000 TL</option>
          <option value="8000" ${state.filterBudget === '8000' ? 'selected' : ''}>4.000–8.000 TL</option>
          <option value="15000" ${state.filterBudget === '15000' ? 'selected' : ''}>8.000 TL+</option>
        </select>
        <button class="secondary" data-reset-filters>Filtreleri temizle</button>
      </div>

      <div class="listing-layout">
        <div>
          <div class="listing-list">
            ${listings.length ? listings.map((item) => `
              <article class="listing-card ${state.selectedListingId === item.id ? 'active' : ''}" data-select-listing="${item.id}">
                <div class="listing-top">
                  ${urgencyBadge(item)}
                  <span class="pill">${item.city}</span>
                </div>
                <h4 class="listing-title">${item.title}</h4>
                <p class="listing-desc">${item.description}</p>
                <div class="card-meta">
                  <span><strong>${item.offers.length}</strong> teklif</span>
                  <span><strong>${item.providerCount}</strong> çözüm veren</span>
                  <span><strong>${fmtDate(item.createdAt)}</strong> yayınlandı</span>
                </div>
                <div class="inline-row">
                  <span class="listing-price">${fmtMoney(item.budgetMin)} – ${fmtMoney(item.budgetMax)}</span>
                  <span class="pill">${remainingParts(item.deadline).text}</span>
                </div>
                <div class="badge-row">
                  ${item.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}
                </div>
              </article>
            `).join('') : '<div class="empty">Filtrelere uyan ilan yok.</div>'}
          </div>
        </div>

        <aside class="detail-card">
          ${listing ? `
            <div class="detail-hero">
              <div class="badge-row">
                ${urgencyBadge(listing)}
                <span class="pill">${categoryLabel(listing.category)}</span>
              </div>
              <h4>${listing.title}</h4>
              <div class="countdown">${remaining?.expired ? 'Süre doldu' : remaining.text}</div>
              <p class="muted" style="margin-top:8px">${listing.city} · ${listing.owner} · ${fmtMoney(listing.budgetMin)}–${fmtMoney(listing.budgetMax)}</p>
              <p class="muted">${listing.description}</p>
            </div>

            <div class="panel">
              <h4>Teklifler</h4>
              <div class="offer-list">${offerList}</div>
            </div>

            <div class="panel">
              <h4>Teklif ver</h4>
              ${listing.status === 'active' ? `
                <form id="offer-form" class="listing-list">
                  <input class="input" name="provider" placeholder="Adınız / işletmeniz" required />
                  <div class="form-grid">
                    <input class="input" name="amount" type="number" placeholder="Fiyat (TL)" min="0" required />
                    <input class="input" name="delivery" placeholder="Teslim süresi" required />
                    <textarea class="full" name="message" placeholder="Kısa teklif mesajı" required></textarea>
                  </div>
                  <button class="primary" type="submit">Teklif gönder</button>
                </form>
              ` : `<div class="empty">Bu talep yeni teklif kabul etmiyor.</div>`}
            </div>
          ` : '<div class="empty">Bir ilan seçin.</div>'}
        </aside>
      </div>
    </section>
  `;
}

function renderCreate() {
  return `
    <section class="section section-grid">
      <div class="form-card">
        <h4>Yeni talep oluştur</h4>
        <form id="create-form" class="listing-list">
          <div class="form-grid">
            <select name="category" required>
              <option value="">Kategori seç</option>
              ${categories.map((c) => `<option value="${c.slug}">${c.label}</option>`).join('')}
            </select>
            <select name="city" required>
              <option value="">Şehir seç</option>
              ${cities.map((city) => `<option value="${city}">${city}</option>`).join('')}
            </select>
            <input class="input" name="title" placeholder="Talep başlığı" required />
            <select name="urgency" required>
              <option value="7 gün">7 gün</option>
              <option value="3 gün">3 gün</option>
              <option value="24 saat">24 saat</option>
              <option value="Bugün Bitsin">Bugün Bitsin</option>
            </select>
            <input class="input" name="budgetMin" type="number" min="0" placeholder="Minimum bütçe" required />
            <input class="input" name="budgetMax" type="number" min="0" placeholder="Maksimum bütçe" required />
            <textarea class="full" name="description" placeholder="İşin detayını yaz" required></textarea>
            <input class="input full" name="owner" placeholder="Talep sahibi adı" required />
          </div>
          <div class="helper">Her talep 7 gün boyunca canlı kalır. Süre dolunca otomatik kapanır.</div>
          <button class="primary" type="submit">Talebi yayınla</button>
        </form>
      </div>

      <div class="panel">
        <h4>Talep yayınlama notları</h4>
        <div class="listing-list">
          <div class="offer-item"><strong>Başlık kısa olsun</strong><small>İşin özünü tek cümlede anlat.</small></div>
          <div class="offer-item"><strong>Bütçeyi dürüst yaz</strong><small>Teklif kalitesini artırır.</small></div>
          <div class="offer-item"><strong>Şehir / online bilgisini ekle</strong><small>Uygun teklif sayısını yükseltir.</small></div>
          <div class="offer-item"><strong>Aciliyet rozeti seç</strong><small>Bugün Bitsin / 24 Saat seçenekleri öne çıkar.</small></div>
          <div class="offer-item"><strong>Chat teklif kabulünden sonra açılır</strong><small>Spam’i azaltır, kontrolü korur.</small></div>
        </div>
      </div>
    </section>
  `;
}

function renderProfile() {
  const activeListings = state.listings.filter((item) => item.status === 'active');
  const acceptedListings = state.listings.filter((item) => item.status === 'accepted');
  const sentOffers = state.listings.reduce((acc, item) => acc + item.offers.length, 0);
  return `
    <section class="section section-grid">
      <div class="profile-card">
        <h4>Talep Sahibi Paneli</h4>
        <div class="listing-list">
          <div class="offer-item"><strong>${activeListings.length}</strong><small>aktif talep</small></div>
          <div class="offer-item"><strong>${acceptedListings.length}</strong><small>kabul edilmiş iş</small></div>
          <div class="offer-item"><strong>${sentOffers}</strong><small>toplam teklif</small></div>
          <div class="offer-item"><strong>7 gün</strong><small>varsayılan yaşam süresi</small></div>
        </div>
      </div>
      <div class="profile-card">
        <h4>Çözüm Veren Vitrini</h4>
        <div class="profile-row">
          <span class="tag">Doğrulamalı profil</span>
          <span class="tag">Mavi tik</span>
          <span class="tag">Portföy</span>
          <span class="tag">Referans</span>
        </div>
        <p class="muted">Yetenek etiketleri ana akışta görünür ama yan roldedir. Ana mekanik yine talep ve teklif akışıdır.</p>
        <div class="listing-list">
          <div class="offer-item"><strong>Güven</strong><small>Kabulden sonra iletişim açılır.</small></div>
          <div class="offer-item"><strong>Hız</strong><small>Süresi dolan talepler otomatik kapanır.</small></div>
          <div class="offer-item"><strong>Netlik</strong><small>Bütçe ve süre baştan görünür.</small></div>
        </div>
      </div>
    </section>
  `;
}

function renderMessages() {
  const threads = acceptedThreads();
  const thread = threads.find((item) => item.id === state.selectedThreadId) || threads[0];
  return `
    <section class="section message-grid">
      <div class="message-card">
        <h4>Aktif sohbetler</h4>
        <div class="thread-list">
          ${threads.length ? threads.map((item) => `
            <div class="thread ${state.selectedThreadId === item.id ? 'active' : ''}" data-thread="${item.id}">
              <strong>${item.title}</strong>
              <div class="muted">${item.owner} ↔ ${item.conversation.length ? item.conversation[item.conversation.length - 1].sender : item.provider}</div>
              <div class="badge-row" style="margin-top:8px">
                <span class="pill">${categoryLabel(item.category)}</span>
                <span class="pill">${item.status === 'accepted' ? 'Açık sohbet' : 'Arşiv'}</span>
              </div>
            </div>
          `).join('') : '<div class="empty">Teklif kabul edilince sohbet burada açılır.</div>'}
        </div>
      </div>
      <div class="message-card chat-box">
        <div>
          <h4>${thread ? thread.title : 'Sohbet yok'}</h4>
          <p class="muted">Önce teklif kabul edilir, sonra iletişim başlar. Bu sayede spam düşer ve pazaryeri daha düzenli kalır.</p>
        </div>
        <div class="chat-log">
          ${thread ? thread.conversation.map((msg) => `
            <div class="bubble ${msg.sender === thread.owner ? 'me' : 'them'}">
              <strong>${msg.sender}</strong>
              <div>${msg.body}</div>
              <small class="muted">${fmtDate(msg.createdAt)}</small>
            </div>
          `).join('') : '<div class="empty">Aktif sohbet bulunmuyor.</div>'}
        </div>
        ${thread ? `
          <form id="chat-form" class="chat-toolbar">
            <textarea name="message" placeholder="Mesaj yaz..." required></textarea>
            <button class="primary" type="submit">Gönder</button>
          </form>
        ` : ''}
      </div>
    </section>
  `;
}

function renderAuthScreen() {
  return `
    <section class="section auth-shell">
      <div class="auth-hero">
        <div>
          <span class="pill">Güvenli giriş</span>
          <h3>Zaman Sepeti'ne giriş yap</h3>
          <p class="lead">Google, Apple, e-posta bağlantısı veya şifreli kayıt ile devam et. Kayıt sonrası profil otomatik oluşur.</p>
          <div class="badge-row">
            <span class="pill">Google</span>
            <span class="pill">Apple</span>
            <span class="pill">Mail linki</span>
            <span class="pill">Mail & şifre</span>
          </div>
        </div>
        <div class="panel auth-panel-note">
          <strong>İpucu</strong>
          <p class="muted">Google ve Apple girişleri için Supabase Authentication sağlayıcılarını dashboard'da açman gerekir.</p>
        </div>
      </div>
      <div class="auth-grid">
        <div class="panel auth-card">
          <div class="section-head">
            <div>
              <h4>Mail ile giriş</h4>
              <p>Şifre ile giriş yapabilir veya bağlantı linki isteyebilirsin.</p>
            </div>
          </div>
          <form class="auth-form" id="login-form">
            <label>
              <span>E-posta</span>
              <input name="email" type="email" placeholder="ornek@mail.com" required />
            </label>
            <label>
              <span>Şifre</span>
              <input name="password" type="password" placeholder="••••••••" />
            </label>
            <div class="hero-actions">
              <button class="primary" type="submit">Mail ile giriş</button>
              <button class="secondary" type="button" data-auth-action="email-link">Giriş linki gönder</button>
            </div>
          </form>
        </div>
        <div class="panel auth-card">
          <div class="section-head">
            <div>
              <h4>Mail ile kaydol</h4>
              <p>Yeni kullanıcı oluştur, profil adını da birlikte kaydet.</p>
            </div>
          </div>
          <form class="auth-form" id="signup-form">
            <label>
              <span>Ad / görünüm adı</span>
              <input name="display_name" type="text" placeholder="Ayşe Yılmaz" required />
            </label>
            <label>
              <span>Şehir</span>
              <input name="city" type="text" placeholder="İstanbul" />
            </label>
            <label>
              <span>E-posta</span>
              <input name="email" type="email" placeholder="ornek@mail.com" required />
            </label>
            <label>
              <span>Şifre</span>
              <input name="password" type="password" minlength="8" placeholder="En az 8 karakter" required />
            </label>
            <div class="hero-actions">
              <button class="primary" type="submit">Mail ile kaydol</button>
            </div>
          </form>
        </div>
        <div class="panel auth-card">
          <div class="section-head">
            <div>
              <h4>Hızlı sosyal giriş</h4>
              <p>Apple ve Google hesabınla tek tıkla devam et.</p>
            </div>
          </div>
          <div class="hero-actions auth-provider-actions">
            <button class="secondary" type="button" data-auth-action="google">Google ile giriş</button>
            <button class="secondary" type="button" data-auth-action="apple">Apple ile giriş</button>
          </div>
          <div class="listing-list" style="margin-top:14px;">
            <div class="offer-item"><strong>Google çalışmıyorsa</strong><small>Supabase dashboard'da provider'ı aç ve redirect URL'yi ekle.</small></div>
            <div class="offer-item"><strong>Apple için</strong><small>Apple OAuth / Sign in with Apple ayarlarını Supabase tarafında tamamla.</small></div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAbout() {
  return `
    <section class="section section-grid">
      <div class="legal-card">
        <h4>Hakkımızda</h4>
        <p class="muted">
          Zaman Sepeti, “zamanı olmayan ama bütçesi olan” kullanıcıların ihtiyaçlarını
          talep olarak yayınladığı; hizmet verenlerin teklif bıraktığı bir hibrit marketplace'tir.
        </p>
        <p class="muted">
          İlhamını sahibinden.com'un ilan yapısı ve Armut'un kategori düzeninden alır; ancak merkeze
          “talep” yerleşir.
        </p>
      </div>
      <div class="legal-card">
        <h4>Legal / Kurumsal</h4>
        <div class="listing-list">
          <div class="offer-item"><strong>Maya Elektronik Bilişim</strong><small>Grup markası ve yasal çatı notu</small></div>
          <div class="offer-item"><strong>KVKK</strong><small>Aydınlatma ve veri işleme metinleri burada yer alır.</small></div>
          <div class="offer-item"><strong>Gizlilik</strong><small>Hesap ve teklif verileri için şeffaf politika.</small></div>
          <div class="offer-item"><strong>İletişim</strong><small>Destek ve moderasyon kanalı.</small></div>
        </div>
      </div>
    </section>
  `;
}

function renderAdminLocked() {
  return `
    <section class="section admin-shell">
      <div class="panel admin-panel">
        <h3>Yönetim kilitli</h3>
        <p class="muted">Bu alan sadece admin rolü olan oturumlarla açılır. Lütfen admin hesabınla giriş yap.</p>
        <div class="listing-list">
          <div class="offer-item"><strong>Oturum</strong><small>${authUser?.email || 'Giriş yapılmadı'}</small></div>
          <div class="offer-item"><strong>Durum</strong><small>${liveMode ? 'Supabase oturumu aktif' : 'Demo modunda admin yok'}</small></div>
          <div class="offer-item"><strong>Yetki</strong><small>public.profiles.role = admin</small></div>
        </div>
      </div>
    </section>
  `;
}

function renderAdmin() {
  if (!isAdminUser) return renderAdminLocked();
  const settings = state.settings || DEFAULT_SETTINGS;
  return `
    <section class="section admin-shell">
      <div class="section-head">
        <div>
          <h3>Yönetim paneli</h3>
          <p>Arkaplan ayarları, görünüm başlangıcı ve AI iş bölümü buradan yönetilir.</p>
        </div>
        <div class="badge-row">
          <span class="pill">${liveMode ? 'Supabase bağlı' : 'Demo modu'}</span>
          <span class="pill">${authUser?.email || 'Anonim yönetici'}</span>
          <span class="pill">${currentProfile?.role || 'role yok'}</span>
        </div>
      </div>

      <div class="admin-layout">
        <div class="panel admin-panel">
          <h4>AI çalışma masası</h4>
          <p class="muted">Her araç için rol, amaç ve kopyalanabilir çalışma metni hazır. Bu panel Zaman Sepeti işlerini önceki AI araç dağılımına göre düzenler.</p>
          <div class="ai-grid">
            ${aiTools.map((tool) => `
              <article class="ai-card">
                <div class="badge-row">
                  <span class="pill">${tool.name}</span>
                  <span class="pill">${tool.role}</span>
                </div>
                <p class="muted">${tool.purpose}</p>
                <pre class="ai-prompt">${tool.prompt}</pre>
                <div class="hero-actions">
                  <button class="secondary" data-open-ai="${tool.url}">Aç</button>
                  <button class="secondary" data-copy-ai="${tool.key}">Kopyala</button>
                </div>
              </article>
            `).join('')}
          </div>
        </div>

        <div class="admin-side">
          <div class="panel admin-panel">
            <h4>Arkaplan ayarları</h4>
            <div class="setting-list">
              <label class="setting-row">
                <span>
                  <strong>Accent tonu</strong>
                  <small>Mor / mavi tonlarını canlı yönet</small>
                </span>
                <input type="range" min="210" max="330" step="1" value="${settings.accentHue}" data-setting="accentHue" />
              </label>
              <label class="setting-row">
                <span>
                  <strong>Sol parlama</strong>
                  <small>Üst sol mor orb yoğunluğu</small>
                </span>
                <input type="range" min="0.05" max="0.9" step="0.01" value="${settings.orb1Opacity}" data-setting="orb1Opacity" />
              </label>
              <label class="setting-row">
                <span>
                  <strong>Sağ parlama</strong>
                  <small>Sağ üst yeşil orb yoğunluğu</small>
                </span>
                <input type="range" min="0.02" max="0.6" step="0.01" value="${settings.orb2Opacity}" data-setting="orb2Opacity" />
              </label>
              <label class="setting-row">
                <span>
                  <strong>Izgara görünürlüğü</strong>
                  <small>Arka plan çizgi dokusu</small>
                </span>
                <input type="range" min="0.01" max="0.06" step="0.001" value="${settings.gridOpacity}" data-setting="gridOpacity" />
              </label>
              <label class="setting-row">
                <span>
                  <strong>Cam bulanıklığı</strong>
                  <small>Panellerin glassmorphism etkisi</small>
                </span>
                <input type="range" min="10" max="32" step="1" value="${settings.glassBlur}" data-setting="glassBlur" />
              </label>
              <label class="setting-row">
                <span>
                  <strong>Başlangıç görünümü</strong>
                  <small>Sayfa açılınca ilk görünen ekran</small>
                </span>
                <select data-setting="defaultView">
                  ${['home', 'market', 'create', 'messages', 'profile', 'about', 'admin'].map((view) => `<option value="${view}" ${settings.defaultView === view ? 'selected' : ''}>${view}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="hero-actions">
              <button class="secondary" data-theme-preset="mor">Mor</button>
              <button class="secondary" data-theme-preset="mavi">Mavi</button>
              <button class="secondary" data-theme-preset="yesil">Yeşil</button>
              <button class="secondary" data-reset-settings>Varsayılan</button>
            </div>
          </div>

          <div class="panel admin-panel">
            <h4>Yönetim kısayolları</h4>
            <div class="listing-list">
              <div class="offer-item"><strong>Yayın akışı</strong><small>Talep açma, teklif ve sohbet düzeni canlı tutulur.</small></div>
              <div class="offer-item"><strong>Gelir araçları</strong><small>Öne çıkarma, rozet ve kurumsal vitrin alanları hazır.</small></div>
              <div class="offer-item"><strong>Operasyon</strong><small>7 günlük süre, kapanış ve moderasyon için temel kurallar açık.</small></div>
              <div class="offer-item"><strong>Yerel demo</strong><small>Tarayıcı verisini temizleyip sıfır başlangıç yapabilirsin.</small></div>
            </div>
            <div class="hero-actions">
              <button class="primary" data-reset-demo>Yerel demoyu sıfırla</button>
              <button class="secondary" data-view="market">Canlı akışı aç</button>
            </div>
            <div class="listing-list" style="margin-top:14px;">
              <div class="offer-item"><strong>Gerçek admin kuralı</strong><small>Supabase profiles tablosunda role = admin olan kullanıcılar yönetim panelini görür.</small></div>
              <div class="offer-item"><strong>Allowlist</strong><small>${[...adminEmails].join(', ')}</small></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}


function renderView() {
  applyTheme();
  if (liveMode && !authUser) {
    state.view = 'auth';
  }
  const body = (() => {
    if (state.view === 'auth') return renderAuthScreen();
    switch (state.view) {
      case 'market': return renderMarket();
      case 'create': return renderCreate();
      case 'profile': return renderProfile();
      case 'messages': return renderMessages();
      case 'about': return renderAbout();
      case 'admin': return renderAdmin();
      case 'home':
      default: return renderHome();
    }
  })();

  const activeCount = state.listings.filter((item) => item.status === 'active').length;
  const expiredCount = state.listings.filter((item) => item.status === 'expired').length;
  const acceptedCount = state.listings.filter((item) => item.status === 'accepted').length;
  const totalOffers = state.listings.reduce((acc, item) => acc + item.offers.length, 0);

  app.innerHTML = `
    ${renderTopbar()}
    <section class="hero" style="margin-top:18px">
      <div>
        <span class="pill">${liveMode && !authUser ? 'Giriş gerekli' : 'Canlı demo · GitHub Pages hazır'}</span>
        <h2>${liveMode && !authUser ? 'Hesabına giriş yap.' : state.view === 'home' ? 'Zaman odaklı marketplace.' : state.view === 'market' ? 'Canlı talep akışı.' : state.view === 'create' ? 'Yeni talep yayınla.' : state.view === 'messages' ? 'Kabul sonrası sohbet.' : state.view === 'profile' ? 'Güven ve görünürlük.' : 'Maya Elektronik Bilişim çatısı.'}</h2>
        <p class="lead">${liveMode && !authUser
          ? 'Google, Apple veya e-posta ile giriş yaparak devam et. Yeni kullanıcılar burada kayıt olabilir.'
          : state.view === 'home'
          ? 'Bu prototip, talep açma, teklif toplama, 7 günlük sayaç ve kabul sonrası iletişim kilidiyle çalışan bir MVP anlatımıdır.'
          : 'Filtreleri kullan, ilanı seç, teklif ver veya bir talebi yayınla.'}</p>
      </div>
      <div class="hero-grid">
        <div class="stat"><div class="kpi">${activeCount}</div><div class="label">aktif talep</div><div class="sub">Şu an teklif kabul eden ilanlar.</div></div>
        <div class="stat"><div class="kpi">${acceptedCount}</div><div class="label">kabul edilmiş iş</div><div class="sub">Sohbeti açılmış görüşmeler.</div></div>
        <div class="stat"><div class="kpi">${expiredCount}</div><div class="label">kapanmış ilan</div><div class="sub">7 gün sonunda otomatik kapananlar.</div></div>
        <div class="stat"><div class="kpi">${totalOffers}</div><div class="label">toplam teklif</div><div class="sub">Talep odaklı teklif ekonomisi.</div></div>
      </div>
    </section>

    ${body}

    <footer class="footer">
      <div>
        <strong>Yasal not</strong>
        <div>Zaman Sepeti, Maya Elektronik Bilişim grup şirketi çatısı altında hizmet vermektedir.</div>
      </div>
      <div class="footer-row">
        <span>KVKK</span>
        <span>Gizlilik</span>
        <span>Kullanım Şartları</span>
        <span>İletişim</span>
      </div>
    </footer>
  `;
  bindEvents();
}

function setView(view) {
  state.view = view;
  persist();
  renderView();
}

function setSelectedListing(id) {
  state.selectedListingId = id;
  state.selectedThreadId = id;
  persist();
  renderView();
}

function acceptOffer(listingId, offerId) {
  if (liveMode) {
    (async () => {
      const client = ensureSupabaseClient();
      if (!client) return;
      const { error } = await client.rpc('accept_offer_and_open_conversation', { p_offer_id: offerId });
      if (error) {
        alert(`Teklif kabul edilemedi: ${error.message}`);
        return;
      }
      await refreshFromSupabase();
      state.view = 'messages';
      state.selectedThreadId = listingId;
      state.selectedListingId = listingId;
      renderView();
    })();
    return;
  }

  state.listings = state.listings.map((listing) => {
    if (listing.id !== listingId) return listing;
    const acceptedOffer = listing.offers.find((offer) => offer.id === offerId);
    if (!acceptedOffer) return listing;
    const updatedOffers = listing.offers.map((offer) => ({
      ...offer,
      status: offer.id === offerId ? 'accepted' : 'rejected',
    }));
    const updatedConversation = listing.conversation.length
      ? listing.conversation
      : [
          { sender: listing.owner, body: 'Teklifinizi kabul ettim. Detayları mesajdan konuşalım.', createdAt: new Date().toISOString() },
          { sender: acceptedOffer.provider, body: 'Harika, hemen başlıyorum. Uygun saatleri paylaşın.', createdAt: new Date().toISOString() },
        ];
    return {
      ...listing,
      status: 'accepted',
      acceptedOfferId: offerId,
      offers: updatedOffers,
      conversation: updatedConversation,
    };
  });
  state.view = 'messages';
  state.selectedThreadId = listingId;
  state.selectedListingId = listingId;
  persist();
  renderView();
}

function addOffer(listingId, formData) {
  if (liveMode) {
    (async () => {
      const client = ensureSupabaseClient();
      if (!client || !authUser) {
        alert('Teklif vermek için giriş yapın.');
        return;
      }
      const { error } = await client.from('offers').insert({
        listing_id: listingId,
        sender_id: authUser.id,
        price: Number(formData.get('amount')),
        eta: formData.get('delivery'),
        message: formData.get('message'),
        status: 'pending',
      });
      if (error) {
        alert(`Teklif gönderilemedi: ${error.message}`);
        return;
      }
      await refreshFromSupabase();
      renderView();
    })();
    return;
  }

  const offer = {
    id: uid(),
    provider: formData.get('provider'),
    amount: Number(formData.get('amount')),
    delivery: formData.get('delivery'),
    message: formData.get('message'),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  state.listings = state.listings.map((listing) => {
    if (listing.id !== listingId) return listing;
    return { ...listing, offers: [offer, ...listing.offers] };
  });
  persist();
  renderView();
}

function createListing(formData) {
  if (liveMode) {
    (async () => {
      const client = ensureSupabaseClient();
      if (!client || !authUser) {
        alert('Talep oluşturmak için giriş yapın.');
        return;
      }
      const categorySlug = formData.get('category');
      const categoryId = categoryIdBySlug.get(categorySlug);
      const payload = {
        owner_id: authUser.id,
        title: formData.get('title'),
        description: formData.get('description'),
        category_id: categoryId,
        city: formData.get('city'),
        budget_min: Math.min(Number(formData.get('budgetMin')), Number(formData.get('budgetMax'))),
        budget_max: Math.max(Number(formData.get('budgetMin')), Number(formData.get('budgetMax'))),
        status: 'active',
        urgency: formData.get('urgency'),
        expires_at: createListingDeadline(formData.get('urgency')),
      };
      const { data, error } = await client.from('listings').insert(payload).select('id').single();
      if (error) {
        alert(`Talep oluşturulamadı: ${error.message}`);
        return;
      }
      state.selectedListingId = data.id;
      state.selectedThreadId = data.id;
      state.view = 'market';
      await refreshFromSupabase();
      renderView();
    })();
    return;
  }

  const min = Number(formData.get('budgetMin'));
  const max = Number(formData.get('budgetMax'));
  const created = {
    id: uid(),
    title: formData.get('title'),
    category: formData.get('category'),
    city: formData.get('city'),
    budgetMin: Math.min(min, max),
    budgetMax: Math.max(min, max),
    urgency: formData.get('urgency'),
    status: 'active',
    owner: formData.get('owner'),
    provider: 'Henüz teklif yok',
    providerCount: Math.floor(Math.random() * 18) + 3,
    createdAt: new Date().toISOString(),
    deadline: daysFromNow(7),
    tags: [formData.get('urgency'), 'Yeni'],
    description: formData.get('description'),
    offers: [],
    acceptedOfferId: null,
    conversation: [],
  };
  state.listings = [created, ...state.listings];
  state.selectedListingId = created.id;
  state.selectedThreadId = created.id;
  state.view = 'market';
  persist();
  renderView();
}

function sendChatMessage(listingId, message) {
  if (liveMode) {
    (async () => {
      const client = ensureSupabaseClient();
      if (!client || !authUser) {
        alert('Mesaj göndermek için giriş yapın.');
        return;
      }
      const listing = state.listings.find((item) => item.id === listingId);
      if (!listing?.conversationId) {
        alert('Bu sohbet henüz açılmadı.');
        return;
      }
      const { error } = await client.from('messages').insert({
        conversation_id: listing.conversationId,
        sender_id: authUser.id,
        body: message,
      });
      if (error) {
        alert(`Mesaj gönderilemedi: ${error.message}`);
        return;
      }
      await refreshFromSupabase();
      renderView();
    })();
    return;
  }

  state.listings = state.listings.map((listing) => {
    if (listing.id !== listingId) return listing;
    const next = {
      sender: listing.owner,
      body: message,
      createdAt: new Date().toISOString(),
    };
    return { ...listing, conversation: [...listing.conversation, next] };
  });
  persist();
  renderView();
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      if (btn.hasAttribute('data-category')) state.filterCategory = btn.getAttribute('data-category');
      setView(view);
    });
  });

  document.querySelectorAll('[data-auth-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-auth-action');
      if (action === 'signout') {
        await signOut();
        return;
      }
      if (action === 'email') {
        state.view = 'auth';
        persist();
        renderView();
        return;
      }
      if (action === 'email-link') {
        const form = document.getElementById('login-form');
        const email = String(form?.querySelector('input[name="email"]')?.value || '').trim();
        if (!email) return alert('Önce e-posta gir.');
        await signInWithEmailLink(email);
        return;
      }
      if (action === 'google') {
        await signInWithGoogle();
        return;
      }
      if (action === 'apple') {
        await signInWithApple();
        return;
      }
      if (action === 'setup') {
        alert('Supabase için config.js içindeki supabaseUrl ve supabaseAnonKey alanlarını doldurun.');
      }
    });
  });

  document.getElementById('login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '').trim();
    if (!email || !password) return alert('E-posta ve şifre gerekli.');
    await signInWithPassword(email, password);
  });

  document.getElementById('signup-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '').trim();
    const displayName = String(formData.get('display_name') || '').trim();
    const city = String(formData.get('city') || '').trim();
    if (!email || !password || !displayName) return alert('Ad, e-posta ve şifre gerekli.');
    await signUpWithEmail(email, password, displayName, city);
  });

  document.querySelectorAll('[data-select-listing]').forEach((item) => {
    item.addEventListener('click', () => setSelectedListing(item.getAttribute('data-select-listing')));
  });

  document.querySelectorAll('[data-thread]').forEach((item) => {
    item.addEventListener('click', () => {
      state.selectedThreadId = item.getAttribute('data-thread');
      state.selectedListingId = item.getAttribute('data-thread');
      persist();
      renderView();
    });
  });

  document.querySelectorAll('[data-accept-offer]').forEach((btn) => {
    btn.addEventListener('click', () => acceptOffer(btn.getAttribute('data-accept-offer'), btn.getAttribute('data-offer-id')));
  });

  document.querySelectorAll('[data-open-ai]').forEach((btn) => {
    btn.addEventListener('click', () => window.open(btn.getAttribute('data-open-ai'), '_blank', 'noopener,noreferrer'));
  });

  document.querySelectorAll('[data-copy-ai]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tool = aiTools.find((item) => item.key === btn.getAttribute('data-copy-ai'));
      if (!tool) return;
      await navigator.clipboard.writeText(tool.prompt);
      btn.textContent = 'Kopyalandı';
      setTimeout(() => { btn.textContent = 'Kopyala'; }, 1200);
    });
  });

  document.querySelectorAll('[data-setting]').forEach((input) => {
    const commit = () => {
      const key = input.getAttribute('data-setting');
      if (!key) return;
      const value = key === 'defaultView' ? input.value : Number(input.value);
      state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}), [key]: value };
      applyTheme();
      persist();
    };
    input.addEventListener('input', commit);
    input.addEventListener('change', commit);
  });

  document.querySelectorAll('[data-theme-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-theme-preset');
      const next = preset === 'mavi'
        ? { accentHue: 214, orb1Opacity: 0.33, orb2Opacity: 0.18, gridOpacity: 0.02, glassBlur: 20 }
        : preset === 'yesil'
          ? { accentHue: 150, orb1Opacity: 0.28, orb2Opacity: 0.34, gridOpacity: 0.018, glassBlur: 20 }
          : { accentHue: 270, orb1Opacity: 0.52, orb2Opacity: 0.22, gridOpacity: 0.028, glassBlur: 24 };
      state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}), ...next };
      applyTheme();
      persist();
      renderView();
    });
  });

  document.querySelector('[data-reset-settings]')?.addEventListener('click', () => {
    state.settings = { ...DEFAULT_SETTINGS };
    applyTheme();
    persist();
    renderView();
  });

  document.querySelector('[data-reset-demo]')?.addEventListener('click', () => {
    const currentView = state.settings?.defaultView || DEFAULT_SETTINGS.defaultView;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VIEW_KEY);
    state = seedState();
    state.settings.defaultView = currentView;
    applyTheme();
    persist();
    renderView();
  });

  document.getElementById('create-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    createListing(formData);
  });

  document.getElementById('offer-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    addOffer(state.selectedListingId, formData);
  });

  document.getElementById('chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const message = String(formData.get('message') || '').trim();
    if (!message) return;
    sendChatMessage(state.selectedThreadId, message);
  });

  const filterCategory = document.getElementById('filter-category');
  const filterCity = document.getElementById('filter-city');
  const filterBudget = document.getElementById('filter-budget');
  filterCategory?.addEventListener('change', (e) => { state.filterCategory = e.target.value; persist(); renderView(); });
  filterCity?.addEventListener('change', (e) => { state.filterCity = e.target.value; persist(); renderView(); });
  filterBudget?.addEventListener('change', (e) => { state.filterBudget = e.target.value; persist(); renderView(); });

  document.querySelector('[data-reset-filters]')?.addEventListener('click', () => {
    state.filterCategory = 'all';
    state.filterCity = 'all';
    state.filterBudget = 'all';
    persist();
    renderView();
  });
}

function tick() {
  updateStatuses();
  renderView();
}

async function bootstrapApp() {
  state = loadState();
  applyTheme();
  recomputeAdminAccess();
  if (hasSupabaseConfig) {
    try {
      await initLiveBackend();
    } catch (error) {
      console.warn('Supabase init failed, staying in demo mode', error);
      liveMode = false;
    }
  }
  renderView();
  setInterval(tick, 1000);
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === VIEW_KEY) {
      state = loadState();
      renderView();
    }
  });
}

bootstrapApp();
