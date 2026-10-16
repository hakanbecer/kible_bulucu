/* ============================================================
   Kıble Bulucu — app.js
   Leaflet haritası, koordinat hesaplama, dijital pusula ve UI/UX.
   Gerekli tüm JavaScript mantığını barındırır.
   ============================================================ */

/* ---------- Helper Functions ---------- */
function degToRad(deg) { return deg * Math.PI / 180; }
function radToDeg(rad) { return rad * 180 / Math.PI; }

/* Büyük daire mesafe hesaplama (Haversine) — metre cinsinden */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Dünya yarıçapı (m)
  const φ1 = degToRad(lat1);
  const φ2 = degToRad(lat2);
  const Δφ = degToRad(lat2 - lat1);
  const Δλ = degToRad(lng2 - lng1);

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/* Bearing hesaplama (Great-circle initial bearing) – 0–360° aralığı */
function calculateBearing(lat1, lng1, lat2, lng2) {
  const φ1 = degToRad(lat1);
  const φ2 = degToRad(lat2);
  const Δλ = degToRad(lng2 - lng1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  let θ = Math.atan2(y, x);
  θ = radToDeg(θ);
  return (θ + 360) % 360;
}

/* Beriğin noktasını döndüren fonksiyon – harita üzerinde poligon çizmek için */
function destinationPoint(lat, lng, bearing, distance) {
  const R = 6371000;
  const φ = degToRad(lat);
  const λ = degToRad(lng);
  const θ = degToRad(bearing);

  const δ = distance / R;
  const φ2 = Math.asin(
    Math.sin(φ) * Math.cos(δ) +
    Math.cos(φ) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 = λ +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ),
      Math.cos(δ) - Math.sin(φ) * Math.sin(φ2)
    );

  return {
    lat: radToDeg(φ2),
    lng: radToDeg(λ2)
  };
}

/* === Kıble yönünü hesaplama ===
   Haritadaki bir koordinat için Kıble yönünü (Kaabe'ye doğru) döndürür.
   Kıble açısı: 0° kuzey, saat yönü (true north).
*/
function calculateQiblaDirection(lat, lng) {
  const kaaba = { lat: 21.4225, lng: 39.8262 };
  return calculateBearing(lat, lng, kaaba.lat, kaaba.lng);
}

/* === Dönüşüm yardımcıları ===
   Açıyı derece + yön kombinasyonuna çevirir. */
function getDirectionName(angle) {
  const directions = ['Kuzey', 'KKB', 'Küçük Kuzey', 'Kuzeydoğu', 'ÇB',
                       'Çok Doğu', 'Doğu', 'ÇB', 'Çok Güney', 'Güney',
                       'Küçük Güney', 'GSB', 'Güneybatı', 'GSB', 'Çok Batı',
                       'Batı', 'BSB', 'Çok Kuzey', 'Kuzey'];
  const index = Math.round(angle / 22.5) % 16;
  return directions[index];
}

/* === Toast yardımcı === */
function showToast(message, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;

  const colors = {
    success: 'var(--gold)',
    error:   'var(--danger)',
    info:    'var(--accent)'
  };
  el.style.background = colors[type] || colors.info;
  el.textContent = message;
  el.hidden = false;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 400);
  }, 3000);
}

/* === Constants === */
const KAABA_COORDS = { lat: 21.4225, lng: 39.8262 };

/* === Application State === */
let map;
let userMarker = null;
let kaabaMarker = null;
let qiblaLine = null;
let currentLocation = null;
let deviceCompassInterval = null;
let lastHeading = null;
let isDark = false;

// Başlangıçta Kıble yönü için varsayılan nokta (İstanbul)
const DEFAULT_COORDS = { lat: 41.0082, lng: 28.9784 };

/* ============================================================
   ADRES ARAMA (Nominatim geocoding)
   ============================================================ */

/* Nominatim API'den adres → koordinat */
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&accept-language=tr`;
  const resp = await fetch(url, {
    headers: { 'Accept-Language': 'tr' }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data || data.length === 0) return null;
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    display: data[0].display_name
  };
}

/* Adres arama butonu + Enter tuşu */
function initAddressSearch() {
  const input = document.getElementById('addressInput');
  const btn = document.getElementById('searchBtn');
  if (!input || !btn) return;

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) {
      showToast('Lütfen bir adres girin.', 'info');
      return;
    }
    showToast('Aranıyor…', 'info');
    try {
      const result = await geocodeAddress(q);
      if (!result) {
        showToast('Sonuç bulunamadı.', 'error');
        return;
      }
      updateCurrentLocation(result.lat, result.lng);
      showToast(`Bulundu: ${result.display}`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Arama hatası. İnternet bağlantınızı kontrol edin.', 'error');
    }
  };

  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

/* ============================================================
   HARİTA
   ============================================================ */

/* Haritayı başlat */
function initMap() {
  map = L.map('map', {
    center: [DEFAULT_COORDS.lat, DEFAULT_COORDS.lng],
    zoom: 4,
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: false
  });

  // OpenStreetMap katmanı
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  // Kâbeyi özel bir marker ile işaretle (Yeşil mavi kubbe)
  kaabaMarker = L.marker([KAABA_COORDS.lat, KAABA_COORDS.lng], {
    icon: L.divIcon({
      html: '<div class="kaaba-marker">🕌</div>',
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    })
  }).addTo(map)
    .bindPopup('<b>Kaabe-i Mükerreme</b><br/>Mekke, Suudi Arabistan');

  // İlk noktayı ayarla (kullanıcı konumunu beklemeden varsayılan)
  updateCurrentLocation(DEFAULT_COORDS.lat, DEFAULT_COORDS.lng);

  // Harita üzerinde tıklama olayı
  map.on('click', function(e) {
    updateCurrentLocation(e.latlng.lat, e.latlng.lng);
  });

  // Tarayıcı resize'da harita boyutunu yeniden hesapla (zoom/pan düzeltmesi)
  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });

  // Sayfa yüklendiğinde biraz gecikle invalidateSize (container height'ı stabil olsun)
  setTimeout(() => { if (map) map.invalidateSize(); }, 200);
}

/* === Kullanıcı konumunu güncelle === */
function updateCurrentLocation(lat, lng) {
  currentLocation = { lat, lng };

  // Kullanıcı marker'ı (mavi) güncelle veya oluştur
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div class="user-marker">📍</div>',
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      }),
      zIndexOffset: 1000
    }).addTo(map);
  }

  // Haritayı yeni konuma odakla
  map.setView([lat, lng], 15);

  // Qıble yönü ve mesafeyi hesapla
  calculateAndDisplayQibla(lat, lng);

  // Bilgi panelini güncelle
  document.getElementById('coordText').textContent = `${lat.toFixed(6)}°, ${lng.toFixed(6)}°`;

  // Okları çiz
  drawQiblaArrow(lat, lng);
}

/* === Kıble yönü hesabı === */
function calculateAndDisplayQibla(lat, lng) {
  const qibla = calculateQiblaDirection(lat, lng);
  const distance = calculateDistance(lat, lng, KAABA_COORDS.lat, KAABA_COORDS.lng);
  const distanceKm = distance / 1000;
  const distanceMi = distanceKm * 0.621371;

  // Açıyı düzenle: 0° kuzey, saat yönü
  const normalizedQibla = ((qibla % 360) + 360) % 360;

  // UI öğelerini güncelle
  document.getElementById('bearingDeg').textContent = Math.round(normalizedQibla) + '°';
  document.getElementById('bearingDir').textContent = getDirectionName(normalizedQibla);
  document.getElementById('angleText').textContent = Math.round(normalizedQibla) + '°';

  // Mesafe kartını güncelle
  if (distanceKm < 1) {
    document.getElementById('distanceText').innerHTML =
      `<span class="highlight">${distanceKm.toFixed(3)} km</span> (${(distanceMi * 100).toFixed(1)} mi)`;
  } else {
    document.getElementById('distanceText').innerHTML =
      `<span class="highlight">${distanceKm.toFixed(2)} km</span> (${distanceMi.toFixed(2)} mi)`;
  }

  // Pusulayı döndür
  rotateCompass(normalizedQibla);

  // Cihaz pusulasını güncelle (hâlâ kayıtlı ise)
  if (lastHeading) {
    document.getElementById('deviceHeading').textContent = Math.round(lastHeading) + '°';
  }
}

/* === Pusulayı döndür === */
function rotateCompass(angle) {
  const needle = document.getElementById('compassNeedle');
  if (!needle) return;

  // İpluk yukarıyı (Kuzey) gösteriyor; kâbe yönü doğrudan dönüş açısı.
  const rotate = angle;

  needle.style.transform = `translate(-50%, -50%) rotate(${rotate}deg)`;
}

/* === Okları harita üzerinde çiz ===
   Seçilen konumdan Kâbe'ye doğru kısayol oku (150 km uzunluğunda).
   Gerçek mesafe Kartpostal olarak gösterilir; ok sadece yön gösterir. */
function drawQiblaArrow(lat, lng) {
  const qibla = calculateQiblaDirection(lat, lng);

  // Oklunun başlangıç noktası (kullanıcı konumu)
  const start = L.latLng(lat, lng);

  // Okun bitişi: kullanıcı konumundan 150 km uzakta, kıble yönünde
  const ARROW_LENGTH_KM = 150;
  const end = destinationPoint(lat, lng, qibla, ARROW_LENGTH_KM * 1000);

  // Mevcut çizgiyi temizle
  if (qiblaLine) {
    qiblaLine.remove();
    qiblaLine = null;
  }

  // Yeni çizgiyi ekle (Leaflet SVG'de CSS değişkeni çalışmaz → hex renk)
  qiblaLine = L.polyline([start, L.latLng(end.lat, end.lng)], {
    color: '#d4af37',
    weight: 4,
    opacity: 0.9,
    dashArray: '8,8'
  }).addTo(map);
}

/* === Kullanıcı konumunu al === */
function getCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('Tarayıcınız konum hizmetini desteklemiyor.', 'error');
    return;
  }

  showToast('Konumunuz alınıyor…', 'info');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      updateCurrentLocation(position.coords.latitude, position.coords.longitude);
      showToast('Konumunuz bulundu.', 'success');
    },
    (error) => {
      let msg = 'Konum alınamadı.';
      switch(error.code) {
        case 1: msg = 'Konum izni reddedildi.'; break;
        case 2: msg = 'Konum bulunamadı.'; break;
        case 3: msg = 'İstek zaman aşımına uğradı.'; break;
      }
      showToast(msg, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

/* === Uygulamayı sıfırla === */
function resetApp() {
  // Markerları temizle (Kâbe hariç)
  if (userMarker) {
    map.removeLayer(userMarker);
    userMarker = null;
  }
  if (qiblaLine) {
    map.removeLayer(qiblaLine);
    qiblaLine = null;
  }

  // Varsayılan konuma dön
  updateCurrentLocation(DEFAULT_COORDS.lat, DEFAULT_COORDS.lng);
  showToast('Uygulama sıfırlandı.', 'success');
}

/* === Cihaz pusulası (DeviceOrientation API) === */
function initDeviceCompass() {
  if (!window.DeviceOrientationEvent) {
    const el = document.getElementById('deviceCompass');
    if (el) el.hidden = true;
    return;
  }

  function deviceCompassHandler(event) {
    if (event.absolute === false) return; // Kuzey eğimi ilgili değilse (basit cihazlarda)

    const heading = Math.round(event.alpha || 0);
    lastHeading = heading;

    const headingEl = document.getElementById('deviceHeading');
    if (headingEl) headingEl.textContent = heading + '°';
    const dc = document.getElementById('deviceCompass');
    if (dc) dc.hidden = false;
  }

  window.addEventListener('deviceorientation', deviceCompassHandler);
}

/* === Tema geçişi === */
function initTheme() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  const stored = localStorage.getItem('theme');
  isDark = stored === 'dark';

  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  btn.textContent = isDark ? '☀️' : '🌙';

  btn.addEventListener('click', () => {
    isDark = !isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    btn.textContent = isDark ? '☀️' : '🌙';
  });
}

/* ============================================================
   BAŞLATMA
   ============================================================ */
function initApp() {
  // DOM hazır
  initMap();
  initDeviceCompass();
  initTheme();
  initAddressSearch();

  // Butonlara olay dinleyicileri ekle
  const locBtn = document.getElementById('locBtn');
  const resetBtn = document.getElementById('resetBtn');
  if (locBtn) locBtn.addEventListener('click', getCurrentLocation);
  if (resetBtn) resetBtn.addEventListener('click', resetApp);

  // İlk konumlama için varsayılan konumu ayarla
  updateCurrentLocation(DEFAULT_COORDS.lat, DEFAULT_COORDS.lng);

  // Harita izni sağlanmadıysa alternatif konumlandırma seçeneği göster
  if (!navigator.geolocation) {
    showToast('Tarayıcıda GPS/Saat bulunamadı. Varsayılan konum kullanılıyor.', 'info');
  }
}

// DOM hazır olduğunda başlat
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

/* ============================================================
   CSS tanımları: .kaaba-marker, .user-marker, .qibla-arrow-line
   app.js tarafından referans alınan ek stilleri ekle
   ============================================================ */
(() => {
  const style = document.createElement('style');
  style.textContent = `
    .kaaba-marker { background: var(--gold); border: 3px solid #fff; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,.35); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .user-marker { background: var(--info); border: 3px solid #fff; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,.35); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
    .qibla-arrow-line { stroke: var(--gold); stroke-width: 4; stroke-linecap: round; opacity: .85; }
  `;
  document.head.appendChild(style);
})();