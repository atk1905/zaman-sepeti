# Zaman Sepeti

Talep odaklı marketplace prototipi.

## Ürün özeti

Zaman Sepeti, zamanı olmayan ama bütçesi olan kullanıcıların ihtiyaçlarını talep olarak yayınladığı; hizmet verenlerin teklif bırakabildiği hibrit bir marketplace prototipidir.

İmza kuralı:
- Her ilan 7 gün canlı kalır
- Geri sayım sayfada görünür
- Süre dolunca ilan otomatik kapanır
- Kabul edilen tekliften sonra mesajlaşma açılır

Kurumsal not:
- Footer ve legal alanlarda Maya Elektronik Bilişim grup notu yer alır.

## Bu repo ne içeriyor?

- Modern tek sayfa web arayüzü
- 7 günlük geri sayım
- Kategori, şehir ve bütçe filtreleri
- Talep oluşturma formu
- Teklif verme ve teklif kabul etme akışı
- Kabul sonrası mesajlaşma kilidi
- GitHub Pages deploy workflow
- Supabase veri modeli ve Edge Function şablonu
- Hermes için hazır agent komut dokümanı

## Canlı demo

GitHub Pages aktif olduğunda adres şu formatta olur:

`https://atk1905.github.io/zaman-sepeti/`

## Yerelde çalıştırma

Bu proje build gerektirmeyen saf HTML/CSS/JS ile hazırlandı.

Basit bir lokal sunucu aç:

```bash
python3 -m http.server 8080
```

Sonra tarayıcıda aç:

`http://localhost:8080`

## Canlı Supabase bağlantısı

Repo, config dosyası varsa otomatik olarak canlı moda geçer.

1. `config.js` içindeki değerleri doldur. İstersen Supabase environment değişkenlerinden kopyala:

```js
window.ZS_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_PUBLISHABLE_OR_ANON_KEY',
  appName: 'Zaman Sepeti',
};
```

Not: Bu projede public tarafta çalışan anahtar için `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `anon` değerini kullan.

2. Supabase tarafında Google ve email OTP auth'u aç
3. GitHub Pages veya lokal sunucuda sayfayı yenile
4. Üst bar'daki "Email ile giriş" / "Google ile giriş" butonları aktif olur

Not:
- `anon key` public tarafta kullanılabilir.
- Service role key client tarafına konmaz.
- Teklif kabulü RPC ile çalışır: `accept_offer_and_open_conversation`
- 7 günlük kapanış için Edge Function: `expire_old_listings`

## Hermes tetikleyici

Repo içindeki `docs/agent-commands.md` dosyasında tek satırlık tetikleyici ve rol bazlı prompt'lar var.
Kullanıcı "execute commands" dediğinde Hermes bu akışı yönetmek üzere tasarlandı.

## MVP seçimi

Bu sürümde ön planda olanlar:
- A: görünür 7 günlük geri sayım
- B: aciliyet rozeti
- Çekirdek akış: talep aç → teklif al → teklif kabul et → sohbet aç

Şunlar faz 2'ye bırakılabilir:
- Zaman bankası
- Sıcak saat modu
- Yenileme tasarısı

## Supabase planı

`supabase/migrations/0001_init.sql` dosyası temel şemayı, RLS politikalarını ve expiry mantığını içerir.
`supabase/functions/expire-listings/index.ts` dosyası ise 7 gün dolan ilanları kapatmak için örnek Edge Function'dır.

## GitHub Pages notu

`/.github/workflows/pages.yml` dosyası push sonrası otomatik deploy için hazırlanmıştır.
