/* ============================================================
   Kıble Bulucu — app.js
   Hassas Astronomik ve Geodezik Hesaplamalar, Leaflet Haritası,
   Canlı Dijital Pusula, Uydu Katmanı, Güneş Açısı ve Namaz Vakitleri.
   ============================================================ */

(() => {
  'use strict';

  /* ============================================================
     1. SABİTLER VE KONFİGÜRASYON
     ============================================================ */
  // Kâbe-i Muazzama'nın yüksek hassasiyetli WGS84 koordinatları (Mekke)
  const KAABA_COORDS = { lat: 21.422487, lng: 39.826206 };
  const EARTH_RADIUS_METERS = 6371008.8; // WGS84 ortalama dünya yarıçapı
  const DEFAULT_COORDS = { lat: 41.0082, lng: 28.9784, name: 'İstanbul, Türkiye' };

  // Harita Katman URL'leri (403 engeli olmayan, yüksek hızlı genel CDN katmanları)
  const TILE_LAYERS = {
    osm: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      options: {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      },
      fallbackUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: {
        attribution: 'Tiles &copy; Esri &mdash; Maxar, Earthstar Geographics, GIS User Community',
        maxZoom: 19
      }
    },
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      options: {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }
    }
  };

  /* ============================================================
     2. UYGULAMA DURUMU (STATE)
     ============================================================ */
  const state = {
    currentLat: DEFAULT_COORDS.lat,
    currentLng: DEFAULT_COORDS.lng,
    currentAddress: DEFAULT_COORDS.name,
    qiblaBearing: 0,
    distanceMeters: 0,
    compassMode: 'fixed', // 'fixed' | 'sensor'
    deviceHeading: null,
    smoothedHeading: null,
    isAligned: false,
    soundEnabled: true,
    isDark: false,
    currentLayerKey: 'osm',
    activeTab: 'compass-tab',
    audioCtx: null
  };

  // Harita Nesneleri
  let map = null;
  let currentTileLayer = null;
  let userMarker = null;
  let kaabaMarker = null;
  let geodesicPolyline = null;
  let localBeamLine = null;
  let accuracyCircle = null;

  // Zamanlayıcılar & İstek İptalleri
  let searchDebounceTimer = null;
  let reverseGeoAbortController = null;
  let lastVibrateTime = 0;
  let lastSoundTime = 0;
  let sensorListenerActive = false;

  /* ============================================================
     3. ASTRONOMİK VE MATEMATİKSEL FONKSİYONLAR
     ============================================================ */
  const degToRad = (deg) => (deg * Math.PI) / 180;
  const radToDeg = (rad) => (rad * 180) / Math.PI;
  const normalizeAngle = (angle) => ((angle % 360) + 360) % 360;

  /**
   * Büyük daire başlangıç yön açısı (Great-Circle Initial Bearing)
   * 0° Kuzey, 90° Doğu, 180° Güney, 270° Batı
   */
  function calculateBearing(lat1, lon1, lat2, lon2) {
    const phi1 = degToRad(lat1);
    const phi2 = degToRad(lat2);
    const deltaLambda = degToRad(lon2 - lon1);

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
              Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

    const theta = Math.atan2(y, x);
    return normalizeAngle(radToDeg(theta));
  }

  /**
   * Büyük daire mesafesi (Haversine Formülü) - Metre cinsinden
   */
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const phi1 = degToRad(lat1);
    const phi2 = degToRad(lat2);
    const deltaPhi = degToRad(lat2 - lat1);
    const deltaLambda = degToRad(lon2 - lon1);

    const a = Math.sin(deltaPhi / 2) ** 2 +
              Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_METERS * c;
  }

  /**
   * Yerküre üzerinde iki nokta arasındaki geodezik (büyük daire yayı) noktaları üretir
   */
  function generateGeodesicPoints(lat1, lon1, lat2, lon2, count = 60) {
    const p1 = degToRad(lat1), l1 = degToRad(lon1);
    const p2 = degToRad(lat2), l2 = degToRad(lon2);
    const dp = p2 - p1, dl = l2 - l1;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    if (d === 0) return [[lat1, lon1], [lat2, lon2]];

    const points = [];
    for (let i = 0; i <= count; i++) {
      const f = i / count;
      const A = Math.sin((1 - f) * d) / Math.sin(d);
      const B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
      const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
      const z = A * Math.sin(p1) + B * Math.sin(p2);
      const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
      const lon = Math.atan2(y, x);
      points.push([radToDeg(lat), radToDeg(lon)]);
    }
    return points;
  }

  /**
   * Belirli bir yönde ve mesafede hedef koordinatı hesaplar (Yerel yön oku için)
   */
  function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
    const R = EARTH_RADIUS_METERS;
    const delta = distanceMeters / R;
    const theta = degToRad(bearingDeg);
    const phi1 = degToRad(lat);
    const lambda1 = degToRad(lon);

    const phi2 = Math.asin(
      Math.sin(phi1) * Math.cos(delta) +
      Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
    );
    const lambda2 = lambda1 + Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );

    return [radToDeg(phi2), radToDeg(lambda2)];
  }

  /**
   * 16 Yönlü Türkçe Rüzgâr Gülü Pusula Yön Adı
   */
  function get16PointDirectionName(angle) {
    const directions = [
      { name: 'Kuzey', abbr: 'K' },
      { name: 'Kuzey-Kuzeydoğu', abbr: 'KKD' },
      { name: 'Kuzeydoğu', abbr: 'KD' },
      { name: 'Doğu-Kuzeydoğu', abbr: 'DKD' },
      { name: 'Doğu', abbr: 'D' },
      { name: 'Doğu-Güneydoğu', abbr: 'DGD' },
      { name: 'Güneydoğu', abbr: 'GD' },
      { name: 'Güney-Güneydoğu', abbr: 'GGD' },
      { name: 'Güney', abbr: 'G' },
      { name: 'Güney-Güneybatı', abbr: 'GGB' },
      { name: 'Güneybatı', abbr: 'GB' },
      { name: 'Batı-Güneybatı', abbr: 'BGB' },
      { name: 'Batı', abbr: 'B' },
      { name: 'Batı-Kuzeybatı', abbr: 'BKB' },
      { name: 'Kuzeybatı', abbr: 'KB' },
      { name: 'Kuzey-Kuzeybatı', abbr: 'KKB' }
    ];
    const index = Math.round(normalizeAngle(angle) / 22.5) % 16;
    return `${directions[index].name} (${directions[index].abbr})`;
  }

  /**
   * Güneşin anlık gökyüzü konumunu (Azimut ve Yükseklik) hesaplar
   */
  function getSolarPosition(date, lat, lng) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const n = jd - 2451545.0;
    let L = (280.460 + 0.9856474 * n) % 360;
    let g = degToRad(((357.528 + 0.9856003 * n) % 360));
    if (L < 0) L += 360;
    const lambda = degToRad((L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360);
    const eps = degToRad(23.439 - 0.0000004 * n);
    const delta = Math.asin(Math.sin(eps) * Math.sin(lambda));
    const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));

    const utHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const gmst = (6.697374558 + 0.06570982441908 * n + 1.00273790935 * utHours) % 24;
    const lmst = normalizeAngle((gmst * 15 + lng));
    const H = degToRad(normalizeAngle((lmst - radToDeg(alpha))));

    const phi = degToRad(lat);
    const sinH = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H);
    const alt = radToDeg(Math.asin(sinH));

    const y = -Math.sin(H);
    const x = Math.tan(delta) * Math.cos(phi) - Math.sin(phi) * Math.cos(H);
    const az = normalizeAngle(radToDeg(Math.atan2(y, x)));

    return { altitude: alt, azimuth: az };
  }

  /**
   * Günün "Kıble Saati"ni hesaplar:
   * Güneşin azimutunun kıble yönü ile örtüştüğü (veya gölgenin tam kıbleyi gösterdiği) dakika.
   */
  function findQiblaHour(baseDate, lat, lng, qiblaAngle) {
    const startOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0);
    let bestTime = null;
    let minDiff = 999;

    // Günün 05:00 ile 20:00 saatleri arasını dakika dakika tara
    for (let min = 5 * 60; min <= 20 * 60; min += 1) {
      const t = new Date(startOfDay.getTime() + min * 60000);
      const pos = getSolarPosition(t, lat, lng);
      if (pos.altitude > 0) { // Güneş ufkun üstünde olmalı
        let diff = Math.abs(pos.azimuth - qiblaAngle);
        if (diff > 180) diff = 360 - diff;
        if (diff < minDiff) {
          minDiff = diff;
          bestTime = t;
        }
      }
    }

    if (minDiff < 1.2 && bestTime) {
      return bestTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return null;
  }

  /**
   * Astronomik Namaz Vakitleri Hesaplama (Diyanet / MWL standardı)
   */
  function calculatePrayerTimes(date, lat, lng) {
    const d = new Date(date);
    const tz = -d.getTimezoneOffset() / 60;

    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();

    const a = Math.floor((14 - month) / 12);
    const y = year + 4800 - a;
    const m = month + 12 * a - 3;
    const jd = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
    const dFrac = jd - 2451545.0;

    const g = (357.529 + 0.98560028 * dFrac) % 360;
    const q = (280.459 + 0.98564736 * dFrac) % 360;
    const L = (q + 1.915 * Math.sin(degToRad(g)) + 0.020 * Math.sin(degToRad(2 * g))) % 360;
    const e = 23.439 - 0.00000036 * dFrac;
    let ra = radToDeg(Math.atan2(Math.cos(degToRad(e)) * Math.sin(degToRad(L)), Math.cos(degToRad(L)))) / 15;
    ra = (ra + 24) % 24;
    const dec = radToDeg(Math.asin(Math.sin(degToRad(e)) * Math.sin(degToRad(L))));

    let eqt = q / 15 - ra;
    if (eqt > 12) eqt -= 24;
    if (eqt < -12) eqt += 24;

    const noon = 12 + tz - lng / 15 - eqt;

    function hourAngle(altAngle) {
      const phi = degToRad(lat);
      const delta = degToRad(dec);
      const alpha = degToRad(altAngle);
      const cosHA = (Math.sin(alpha) - Math.sin(phi) * Math.sin(delta)) / (Math.cos(phi) * Math.cos(delta));
      if (cosHA > 1 || cosHA < -1) return null;
      return radToDeg(Math.acos(cosHA)) / 15;
    }

    const haFajr = hourAngle(-18);
    const haSunrise = hourAngle(-0.833);
    const haIsha = hourAngle(-17);

    // İkindi: Asr (Gölge boyu = 1 + öğle gölgesi)
    const phi = degToRad(lat);
    const delta = degToRad(dec);
    const asrAlt = radToDeg(Math.atan(1 / (1 + Math.tan(Math.abs(phi - delta)))));
    const haAsr = hourAngle(asrAlt);

    function fmt(hrs) {
      if (hrs === null || isNaN(hrs)) return '--:--';
      hrs = (hrs + 24) % 24;
      const h = Math.floor(hrs);
      const min = Math.floor((hrs - h) * 60);
      return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    }

    return {
      imsak: fmt(noon - (haFajr || 0)),
      gunes: fmt(noon - (haSunrise || 0)),
      ogle: fmt(noon),
      ikindi: fmt(noon + (haAsr || 0)),
      aksam: fmt(noon + (haSunrise || 0)),
      yatsi: fmt(noon + (haIsha || 0))
    };
  }

  /* ============================================================
     4. SES VE TİTREŞİM (FEEDBACK)
     ============================================================ */
  function playAlignmentChime() {
    if (!state.soundEnabled) return;
    const now = Date.now();
    if (now - lastSoundTime < 3000) return; // 3 saniyede en fazla 1 kez çal
    lastSoundTime = now;

    try {
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }

      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, state.audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, state.audioCtx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.001, state.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, state.audioCtx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(state.audioCtx.destination);

      osc.start();
      osc.stop(state.audioCtx.currentTime + 0.45);
    } catch (e) {
      console.warn('AudioContext hatası:', e);
    }
  }

  function triggerHapticAlignment() {
    const now = Date.now();
    if (now - lastVibrateTime < 2500) return;
    lastVibrateTime = now;

    if (navigator.vibrate) {
      try {
        navigator.vibrate([40, 30, 40]);
      } catch (e) {}
    }
  }

  /* ============================================================
     5. BİLDİRİM VE TOAST
     ============================================================ */
  function showToast(message, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;

    const colors = {
      success: 'var(--primary)',
      error: 'var(--accent-red)',
      info: 'var(--bg-topbar)'
    };
    el.style.background = colors[type] || colors.info;
    el.textContent = message;
    el.hidden = false;
    el.classList.add('show');

    clearTimeout(el._toastTimer);
    el._toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 350);
    }, 3200);
  }

  /* ============================================================
     6. HARİTA YÖNETİMİ (LEAFLET.JS)
     ============================================================ */
  function initMap() {
    map = L.map('map', {
      center: [state.currentLat, state.currentLng],
      zoom: 6,
      zoomControl: false,
      worldCopyJump: true,
      attributionControl: false
    });

    // Varsayılan Katmanı Ekle
    setMapLayer('osm');

    // Sağ alta mini zoom kontrolü
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Kâbe Marker'ı (Özel 3D İkon & Zengin Açılır Pencere)
    const kaabaIcon = L.divIcon({
      className: 'kaaba-marker-wrap',
      html: '<div class="kaaba-marker-icon" title="Kâbe-i Muazzama, Mekke">🕌</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    kaabaMarker = L.marker([KAABA_COORDS.lat, KAABA_COORDS.lng], {
      icon: kaabaIcon,
      zIndexOffset: 1200
    }).addTo(map);

    kaabaMarker.bindPopup(`
      <div class="popup-kaaba-card">
        <h4 class="popup-kaaba-title">🕋 Kâbe-i Muazzama</h4>
        <p class="popup-kaaba-text">
          <strong>Mescid-i Harâm, Mekke</strong><br/>
          Suudi Arabistan (21.4225° K, 39.8262° D)<br/>
          <em>Müslümanların kıblesi ve namaz yönü</em>
        </p>
      </div>
    `);

    // Kullanıcı Marker'ı (Sürüklenebilir)
    updateUserMarker(state.currentLat, state.currentLng);

    // Haritada Tıklama ile Konum Değiştirme
    map.on('click', (e) => {
      // Zoom seviyesini bozmadan mevcut zoomda yumuşakça odaklan
      setLocation(e.latlng.lat, e.latlng.lng, false);
      reverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    // Harita Boyutlanma Düzeltmesi
    window.addEventListener('resize', () => {
      if (map) map.invalidateSize();
    });
  }

  function setMapLayer(key) {
    if (!TILE_LAYERS[key]) return;
    if (currentTileLayer) map.removeLayer(currentTileLayer);

    const layerConf = TILE_LAYERS[key];
    currentTileLayer = L.tileLayer(layerConf.url, layerConf.options).addTo(map);

    // Herhangi bir tile yüklenemezse veya engellenirse yedek sunucudan otomatik yükle
    if (layerConf.fallbackUrl) {
      currentTileLayer.on('tileerror', function(error) {
        if (error && error.tile && !error.tile._hasFallenBack) {
          error.tile._hasFallenBack = true;
          const coords = error.coords;
          error.tile.src = layerConf.fallbackUrl
            .replace('{z}', coords.z)
            .replace('{y}', coords.y)
            .replace('{x}', coords.x);
        }
      });
    }

    state.currentLayerKey = key;

    // Buton aktiflik sınıflarını güncelle
    document.querySelectorAll('.map-control-group .map-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    if (key === 'osm') document.getElementById('mapLayerOsm')?.classList.add('active');
    if (key === 'satellite') document.getElementById('mapLayerSatellite')?.classList.add('active');
    if (key === 'dark') document.getElementById('mapLayerDark')?.classList.add('active');
  }

  function updateUserMarker(lat, lng) {
    if (!map) return;

    if (userMarker) {
      userMarker.setLatLng([lat, lng]);
    } else {
      const userIcon = L.divIcon({
        className: 'user-marker-container',
        html: `
          <div class="user-marker-wrap">
            <div class="user-marker-pulse"></div>
            <div class="user-marker-dot"></div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      userMarker = L.marker([lat, lng], {
        icon: userIcon,
        draggable: true,
        zIndexOffset: 1000
      }).addTo(map);

      // Sürükleme Olayları (Gerçek Zamanlı Güncelleme)
      userMarker.on('drag', (e) => {
        const pos = e.target.getLatLng();
        updateCalculations(pos.lat, pos.lng);
        drawQiblaLines(pos.lat, pos.lng);
      });

      userMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        setLocation(pos.lat, pos.lng, false);
        reverseGeocode(pos.lat, pos.lng);
      });
    }
  }

  /**
   * Kâbe'ye uzanan Geodezik Büyük Daire Çizgisi ve Yerel Yön Işını Çizimi
   */
  function drawQiblaLines(lat, lng) {
    if (!map) return;

    // 1. Geodezik Büyük Daire Eğrisi (User -> Kaaba)
    const arcPoints = generateGeodesicPoints(lat, lng, KAABA_COORDS.lat, KAABA_COORDS.lng, 70);

    if (geodesicPolyline) {
      geodesicPolyline.setLatLngs(arcPoints);
    } else {
      geodesicPolyline = L.polyline(arcPoints, {
        className: 'qibla-geodesic-line',
        color: '#fbbf24',
        weight: 3.5,
        opacity: 0.95
      }).addTo(map);
    }

    // 2. Yerel Yön Işını (Kullanıcı noktasından sokağa/bina çatısına 1 km uzanan net çizgi)
    const bearing = calculateBearing(lat, lng, KAABA_COORDS.lat, KAABA_COORDS.lng);
    const beamEnd = destinationPoint(lat, lng, bearing, 1200);

    if (localBeamLine) {
      localBeamLine.setLatLngs([[lat, lng], beamEnd]);
    } else {
      localBeamLine = L.polyline([[lat, lng], beamEnd], {
        className: 'qibla-beam-line',
        color: '#10b981',
        weight: 4.5,
        opacity: 0.9
      }).addTo(map);
    }
  }

  /**
   * Kâbe ve kullanıcıyı aynı ekrana sığdır (Fit Bounds)
   */
  function fitKaabaAndUser() {
    if (!map) return;
    const bounds = L.latLngBounds([
      [state.currentLat, state.currentLng],
      [KAABA_COORDS.lat, KAABA_COORDS.lng]
    ]);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  }

  /**
   * Kullanıcı konumuna bina/sokak düzeyinde yaklaş (Zoom 17)
   */
  function zoomToUserLocation() {
    if (!map) return;
    map.flyTo([state.currentLat, state.currentLng], 17, { duration: 1.2 });
  }

  /**
   * Kâbe-i Muazzama'ya uç (Zoom 16)
   */
  function flyToKaaba() {
    if (!map) return;
    map.flyTo([KAABA_COORDS.lat, KAABA_COORDS.lng], 16, { duration: 2.0 });
    setTimeout(() => {
      kaabaMarker?.openPopup();
    }, 2100);
  }

  /* ============================================================
     7. PUSULA SVG ÇİZİMİ VE KONTROLÜ
     ============================================================ */
  function renderCompassTicks() {
    const group = document.getElementById('dialTicksGroup');
    if (!group) return;

    let svgHtml = '';
    // 0 ile 360 derece arası çizgiler ve açılar
    for (let deg = 0; deg < 360; deg += 5) {
      const isMajor = deg % 30 === 0;
      const isMedium = deg % 10 === 0 && !isMajor;
      const rad = degToRad(deg);

      const rOuter = 146;
      let rInner = 140;
      let strokeWidth = 1;
      let strokeColor = '#475569';

      if (isMajor) {
        rInner = 132;
        strokeWidth = 2;
        strokeColor = deg === 0 ? '#ef4444' : '#fbbf24';
      } else if (isMedium) {
        rInner = 136;
        strokeWidth = 1.5;
        strokeColor = '#94a3b8';
      }

      const x1 = 160 + rOuter * Math.sin(rad);
      const y1 = 160 - rOuter * Math.cos(rad);
      const x2 = 160 + rInner * Math.sin(rad);
      const y2 = 160 - rInner * Math.cos(rad);

      svgHtml += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;

      // 30 derecelik aralıklarla sayıları bas (K, D, G, B harfleri hariç)
      if (isMajor && deg % 90 !== 0) {
        const rText = 122;
        const tx = 160 + rText * Math.sin(rad);
        const ty = 160 - rText * Math.cos(rad) + 3;
        svgHtml += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" text-anchor="middle" class="degree-text">${deg}°</text>`;
      }
    }
    group.innerHTML = svgHtml;
  }

  /**
   * Pusula İğnesini ve Kadranını Güncelle
   */
  function updateCompassVisuals() {
    const needle = document.getElementById('needleGroup');
    const dial = document.getElementById('compassDial');
    const kaabaMarkerEl = document.getElementById('kaabaDialMarker');
    const glow = document.getElementById('compassGlow');
    const guidance = document.getElementById('guidanceBanner');
    const guidanceText = document.getElementById('guidanceText');
    const guidanceIcon = document.getElementById('guidanceIcon');
    const sighter = document.getElementById('phoneSighter');

    if (!needle || !kaabaMarkerEl) return;

    const qibla = state.qiblaBearing;

    // Kâbe rozetini kadran çemberinde kıble açısına çevir
    kaabaMarkerEl.setAttribute('transform', `rotate(${qibla} 160 160)`);

    if (state.compassMode === 'fixed') {
      // 1. MOD: SABİT KADRAN (Harita Modu)
      // Kadran sabittir (Kuzey yukarıda), İğne doğrudan Kâbe yönüne döner
      if (dial) dial.style.transform = 'rotate(0deg)';
      needle.setAttribute('transform', `rotate(${qibla} 160 160)`);
      if (sighter) sighter.classList.remove('visible');

      // Sabit modda yön hesaplanmış bildirimi
      state.isAligned = false;
      glow?.classList.remove('aligned');
      if (guidance) {
        guidance.className = 'guidance-banner';
        guidanceText.textContent = `Kıble Açısı: ${Math.round(qibla)}° (${get16PointDirectionName(qibla)})`;
        guidanceIcon.textContent = '🕋';
      }
    } else {
      // 2. MOD: CANLI CİHAZ PUSULASI (Sensör Modu)
      // Telefon dönerken kadran telefon açısına göre ters döner (Kuzey gerçek kuzeyle eşleşir)
      if (sighter) sighter.classList.add('visible');

      const heading = state.smoothedHeading !== null ? state.smoothedHeading : 0;
      if (dial) dial.style.transform = `rotate(${-heading}deg)`;
      needle.setAttribute('transform', `rotate(${qibla} 160 160)`);

      // Cihazın üst kenarı (heading) ile Kıble açısı arasındaki açı farkı
      let diff = qibla - heading;
      while (diff < -180) diff += 360;
      while (diff > 180) diff -= 360;

      const absDiff = Math.abs(diff);

      if (absDiff <= 3.0) {
        // TAM KIBLE HİZASI! (±3 derece tolerans)
        state.isAligned = true;
        glow?.classList.add('aligned');

        if (guidance) {
          guidance.className = 'guidance-banner aligned';
          guidanceText.textContent = 'TAM KIBLE HİZASINDASINIZ! 🕌';
          guidanceIcon.textContent = '✓';
        }

        // Haptik titreşim ve ses bildirimi
        triggerHapticAlignment();
        playAlignmentChime();
      } else {
        state.isAligned = false;
        glow?.classList.remove('aligned');

        const roundDiff = Math.round(absDiff);
        if (diff > 0) {
          // Sağa dönmeli
          if (guidance) {
            guidance.className = 'guidance-banner turn-right';
            guidanceText.textContent = `${roundDiff}° Sağa Dönün ↻`;
            guidanceIcon.textContent = '➡️';
          }
        } else {
          // Sola dönmeli
          if (guidance) {
            guidance.className = 'guidance-banner turn-left';
            guidanceText.textContent = `${roundDiff}° Sola Dönün ↺`;
            guidanceIcon.textContent = '⬅️';
          }
        }
      }
    }
  }

  /* ============================================================
     8. CİHAZ PUSULA SENSÖRÜ (DEVICE ORIENTATION API)
     ============================================================ */
  async function requestDeviceOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        return response === 'granted';
      } catch (err) {
        console.warn('Sensör izni hatası:', err);
        return false;
      }
    }
    return true; // Standart tarayıcılarda izne gerek yok
  }

  function handleDeviceOrientation(e) {
    let heading = null;

    // iOS WebKit Compass Heading
    if (typeof e.webkitCompassHeading !== 'undefined') {
      heading = e.webkitCompassHeading;
    }
    // Android / Standart absolute alpha
    else if (e.alpha !== null) {
      if (e.absolute === true || typeof e.absolute === 'undefined') {
        heading = (360 - e.alpha) % 360;
      } else {
        heading = (360 - e.alpha) % 360;
      }
    }

    if (heading === null || isNaN(heading)) return;

    state.deviceHeading = normalizeAngle(heading);

    // Düşük Geçirgen Filtre (Low-Pass Filter) ile titreşimi önleme
    if (state.smoothedHeading === null) {
      state.smoothedHeading = state.deviceHeading;
    } else {
      let delta = state.deviceHeading - state.smoothedHeading;
      while (delta < -180) delta += 360;
      while (delta > 180) delta -= 360;
      state.smoothedHeading = normalizeAngle(state.smoothedHeading + delta * 0.25);
    }

    // Durum Çubuğunu Güncelle
    const statusText = document.getElementById('sensorStatusText');
    if (statusText) {
      statusText.textContent = `Pusula Yönü: ${Math.round(state.smoothedHeading)}° (Canlı Sensör Aktif)`;
    }

    if (state.compassMode === 'sensor') {
      updateCompassVisuals();
    }
  }

  async function activateSensorMode() {
    const granted = await requestDeviceOrientationPermission();
    if (!granted) {
      showToast('Pusula sensörü erişim izni verilmedi.', 'error');
      setCompassMode('fixed');
      return;
    }

    if (!sensorListenerActive) {
      // Android modern event
      if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', handleDeviceOrientation, true);
      } else if ('ondeviceorientation' in window) {
        window.addEventListener('deviceorientation', handleDeviceOrientation, true);
      }
      sensorListenerActive = true;
    }

    const sensorBar = document.getElementById('sensorBar');
    if (sensorBar) sensorBar.hidden = false;

    showToast('Canlı pusula sensörü etkinleştirildi.', 'success');
  }

  function setCompassMode(mode) {
    state.compassMode = mode;
    const fixedBtn = document.getElementById('modeFixedBtn');
    const sensorBtn = document.getElementById('modeSensorBtn');
    const sensorBar = document.getElementById('sensorBar');

    if (mode === 'fixed') {
      fixedBtn?.classList.add('active');
      sensorBtn?.classList.remove('active');
      fixedBtn?.setAttribute('aria-checked', 'true');
      sensorBtn?.setAttribute('aria-checked', 'false');
      if (sensorBar) sensorBar.hidden = true;
    } else {
      sensorBtn?.classList.add('active');
      fixedBtn?.classList.remove('active');
      sensorBtn?.setAttribute('aria-checked', 'true');
      fixedBtn?.setAttribute('aria-checked', 'false');
      activateSensorMode();
    }

    updateCompassVisuals();
  }

  /* ============================================================
     9. HESAPLAMA VE ARAYÜZÜ GÜNCELLEME
     ============================================================ */
  function updateCalculations(lat, lng) {
    state.currentLat = lat;
    state.currentLng = lng;

    // Kıble Açısı ve Mesafesi
    const bearing = calculateBearing(lat, lng, KAABA_COORDS.lat, KAABA_COORDS.lng);
    const distanceM = calculateDistance(lat, lng, KAABA_COORDS.lat, KAABA_COORDS.lng);

    state.qiblaBearing = bearing;
    state.distanceMeters = distanceM;

    const distanceKm = distanceM / 1000;
    const distanceMi = distanceKm * 0.621371;

    // Metrik Kartları
    const angleText = document.getElementById('angleText');
    const distanceText = document.getElementById('distanceText');
    const distanceMiText = document.getElementById('distanceMiText');
    const bearingDeg = document.getElementById('bearingDeg');
    const bearingDir = document.getElementById('bearingDir');
    const bearingPrecision = document.getElementById('bearingPrecision');

    if (angleText) angleText.textContent = `${bearing.toFixed(2)}°`;
    if (bearingDeg) bearingDeg.textContent = `${Math.round(bearing)}°`;
    if (bearingDir) bearingDir.textContent = get16PointDirectionName(bearing);
    if (bearingPrecision) bearingPrecision.textContent = `Hassas: ${bearing.toFixed(4)}°`;

    if (distanceText) {
      if (distanceKm < 1) {
        distanceText.textContent = `${Math.round(distanceM)} m`;
      } else {
        distanceText.textContent = `${distanceKm.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km`;
      }
    }
    if (distanceMiText) {
      distanceMiText.textContent = `Kuş uçuşu (~${distanceMi.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} mil)`;
    }

    // Günün Kıble Saati
    const now = new Date();
    const qiblaHour = findQiblaHour(now, lat, lng, bearing);
    const qiblaHourText = document.getElementById('qiblaHourText');
    const qiblaHourHint = document.getElementById('qiblaHourHint');
    if (qiblaHourText) {
      qiblaHourText.textContent = qiblaHour || 'Güneş Uygun Değil';
    }
    if (qiblaHourHint) {
      qiblaHourHint.textContent = qiblaHour ? 'Bugün güneşe dönünce tam kıbledesiniz' : 'Güneş kıble açısına ulaşmıyor';
    }

    // Mekke Yerel Saati
    updateMeccaTime();

    // Namaz Vakitleri
    updatePrayerTimes(now, lat, lng);

    // Güneş Konumu Bilgisi
    updateSunDetails(now, lat, lng, bearing);

    // Harita Alt Rozeti
    updateMapLocationBadge(lat, lng, state.currentAddress);

    // Pusula Görünümünü Yenile
    updateCompassVisuals();
  }

  function setLocation(lat, lng, changeZoom = true) {
    state.currentLat = lat;
    state.currentLng = lng;

    updateCalculations(lat, lng);
    updateUserMarker(lat, lng);
    drawQiblaLines(lat, lng);

    if (changeZoom && map) {
      map.setView([lat, lng], 13);
    } else if (map) {
      map.panTo([lat, lng]);
    }
  }

  function updateMeccaTime() {
    const el = document.getElementById('meccaTimeText');
    if (!el) return;
    try {
      const now = new Date();
      // Mekke UTC+3
      const meccaStr = now.toLocaleTimeString('tr-TR', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit'
      });
      el.textContent = meccaStr;
    } catch (e) {
      el.textContent = '--:--';
    }
  }

  function updatePrayerTimes(date, lat, lng) {
    const times = calculatePrayerTimes(date, lat, lng);
    document.getElementById('timeImsak').textContent = times.imsak;
    document.getElementById('timeGunes').textContent = times.gunes;
    document.getElementById('timeOgle').textContent = times.ogle;
    document.getElementById('timeIkindi').textContent = times.ikindi;
    document.getElementById('timeAksam').textContent = times.aksam;
    document.getElementById('timeYatsi').textContent = times.yatsi;

    // Vakitleri karşılaştırıp o anki aktif vakti vurgula
    highlightCurrentPrayer(times);
  }

  function highlightCurrentPrayer(times) {
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();

    const parseMin = (str) => {
      const parts = str.split(':').map(Number);
      return parts[0] * 60 + parts[1];
    };

    const slots = [
      { id: 'pt-imsak', min: parseMin(times.imsak) },
      { id: 'pt-gunes', min: parseMin(times.gunes) },
      { id: 'pt-ogle', min: parseMin(times.ogle) },
      { id: 'pt-ikindi', min: parseMin(times.ikindi) },
      { id: 'pt-aksam', min: parseMin(times.aksam) },
      { id: 'pt-yatsi', min: parseMin(times.yatsi) }
    ];

    slots.forEach(s => document.getElementById(s.id)?.classList.remove('current-prayer'));

    let activeId = 'pt-yatsi';
    for (let i = slots.length - 1; i >= 0; i--) {
      if (curMin >= slots[i].min) {
        activeId = slots[i].id;
        break;
      }
    }
    document.getElementById(activeId)?.classList.add('current-prayer');
  }

  function updateSunDetails(date, lat, lng, qiblaAngle) {
    const sol = getSolarPosition(date, lat, lng);
    const azEl = document.getElementById('sunAzimuthText');
    const altEl = document.getElementById('sunAltitudeText');
    const relEl = document.getElementById('sunRelativeText');

    if (azEl) azEl.textContent = `${sol.azimuth.toFixed(1)}° (${get16PointDirectionName(sol.azimuth)})`;
    if (altEl) altEl.textContent = `${sol.altitude.toFixed(1)}° ${sol.altitude > 0 ? '(Gündüz)' : '(Ufuk Altı / Gece)'}`;

    if (relEl) {
      if (sol.altitude <= 0) {
        relEl.textContent = '🌙 Güneş şu an ufkun altında (gece vakti). Güneş ile kıble tayini için gündüzü bekleyin.';
      } else {
        let diff = sol.azimuth - qiblaAngle;
        while (diff < -180) diff += 360;
        while (diff > 180) diff -= 360;

        const absDiff = Math.abs(diff).toFixed(1);
        if (Math.abs(diff) < 2.0) {
          relEl.textContent = '☀️ Mükemmel an! Güneş şu an tam kıble yönünde duruyor.';
        } else if (diff > 0) {
          relEl.textContent = `☀️ Güneş şu an Kıble'nin ${absDiff}° SAĞINDA yer alıyor. Güneşe bakıp ${absDiff}° sola dönerseniz Kıble'ye ulaşırsınız.`;
        } else {
          relEl.textContent = `☀️ Güneş şu an Kıble'nin ${absDiff}° SOLUNDA yer alıyor. Güneşe bakıp ${absDiff}° sağa dönerseniz Kıble'ye ulaşırsınız.`;
        }
      }
    }
  }

  function updateMapLocationBadge(lat, lng, addressText) {
    const textEl = document.getElementById('mapBadgeText');
    if (!textEl) return;
    const coordStr = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    textEl.textContent = addressText ? `${addressText} (${coordStr})` : coordStr;
  }

  /* ============================================================
     10. COĞRAFİ ARAMA VE TERS GEOCODING (PHOTON & NOMINATIM)
     ============================================================ */
  async function reverseGeocode(lat, lng) {
    if (reverseGeoAbortController) {
      reverseGeoAbortController.abort();
    }
    reverseGeoAbortController = new AbortController();

    // 1. Önce Hızlı ve Engellenmeyen Photon Komoot API'yi dene
    try {
      const photonUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=tr`;
      const res = await fetch(photonUrl, { signal: reverseGeoAbortController.signal });
      if (res.ok) {
        const data = await res.json();
        const feat = data?.features?.[0];
        if (feat && feat.properties) {
          const p = feat.properties;
          const parts = [
            p.name,
            p.district || p.city,
            p.state || p.country
          ].filter(Boolean);

          const shortName = parts.filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ');
          if (shortName) {
            state.currentAddress = shortName;
            updateMapLocationBadge(lat, lng, shortName);
            const input = document.getElementById('addressInput');
            if (input && document.activeElement !== input) {
              input.value = shortName;
            }
            return;
          }
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }

    // 2. Yedek: Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=tr`;
      const res = await fetch(url, { signal: reverseGeoAbortController.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.display_name) {
        const addr = data.address || {};
        const parts = [
          addr.suburb || addr.neighbourhood || addr.quarter,
          addr.town || addr.city_district || addr.district || addr.city,
          addr.province || addr.state,
          addr.country
        ].filter(Boolean);

        const shortName = parts.slice(0, 3).join(', ') || data.display_name;
        state.currentAddress = shortName;
        updateMapLocationBadge(lat, lng, shortName);

        const input = document.getElementById('addressInput');
        if (input && document.activeElement !== input) {
          input.value = shortName;
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('Reverse geocode error:', e);
      }
    }
  }

  async function searchLocation(query) {
    if (!query) return;

    // Koordinat formatı kontrolü: ör. "41.0082, 28.9784"
    const coordMatch = query.match(/^([-+]?[0-9]*\.?[0-9]+)[\s,]+([-+]?[0-9]*\.?[0-9]+)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        state.currentAddress = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
        setLocation(lat, lng, true);
        reverseGeocode(lat, lng);
        showToast('Koordinata gidildi.', 'success');
        closeSuggestions();
        return;
      }
    }

    showToast('Konum aranıyor…', 'info');

    // 1. Önce Photon API
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=tr`;
      const res = await fetch(photonUrl);
      if (res.ok) {
        const data = await res.json();
        const feat = data?.features?.[0];
        if (feat && feat.geometry && feat.geometry.coordinates) {
          const lng = parseFloat(feat.geometry.coordinates[0]);
          const lat = parseFloat(feat.geometry.coordinates[1]);
          const p = feat.properties || {};
          const title = [p.name, p.district, p.city, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
          state.currentAddress = title || query;

          setLocation(lat, lng, true);
          showToast(`Bulundu: ${state.currentAddress}`, 'success');
          closeSuggestions();
          return;
        }
      }
    } catch (e) {
      console.warn('Photon arama yedek servise devrediliyor:', e);
    }

    // 2. Yedek: Nominatim API
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=tr`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Arama yanıt vermedi');
      const data = await res.json();

      if (!data || data.length === 0) {
        showToast('Konum bulunamadı. Lütfen farklı bir arama yapın.', 'error');
        return;
      }

      const first = data[0];
      const lat = parseFloat(first.lat);
      const lng = parseFloat(first.lon);
      state.currentAddress = first.display_name.split(',').slice(0, 3).join(',');

      setLocation(lat, lng, true);
      showToast(`Bulundu: ${state.currentAddress}`, 'success');
      closeSuggestions();
    } catch (err) {
      console.error(err);
      showToast('Arama sırasında bir hata oluştu.', 'error');
    }
  }

  async function fetchSuggestions(query) {
    if (!query || query.length < 2) {
      closeSuggestions();
      return;
    }

    const container = document.getElementById('searchSuggestions');
    if (!container) return;

    // 1. Önce Photon ile önerileri al
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=tr`;
      const res = await fetch(photonUrl);
      if (res.ok) {
        const data = await res.json();
        const features = data?.features || [];
        if (features.length > 0) {
          container.innerHTML = features.map(feat => {
            const lng = feat.geometry.coordinates[0];
            const lat = feat.geometry.coordinates[1];
            const p = feat.properties || {};
            const title = [p.name, p.district, p.city, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
            return `
              <div class="suggestion-item" data-lat="${lat}" data-lng="${lng}" data-name="${encodeURIComponent(title)}">
                <span class="suggestion-icon">📍</span>
                <span>${title}</span>
              </div>
            `;
          }).join('');

          container.hidden = false;
          bindSuggestionClicks(container);
          return;
        }
      }
    } catch (e) {
      console.warn('Photon öneri hatası, Nominatim deneniyor:', e);
    }

    // 2. Yedek: Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=tr`;
      const res = await fetch(url);
      if (!res.ok) return;
      const list = await res.json();

      if (!list || list.length === 0) {
        container.hidden = true;
        return;
      }

      container.innerHTML = list.map(item => {
        const title = item.display_name;
        return `
          <div class="suggestion-item" data-lat="${item.lat}" data-lng="${item.lon}" data-name="${encodeURIComponent(title)}">
            <span class="suggestion-icon">📍</span>
            <span>${title}</span>
          </div>
        `;
      }).join('');

      container.hidden = false;
      bindSuggestionClicks(container);
    } catch (e) {
      console.warn('Öneri hatası:', e);
    }
  }

  function bindSuggestionClicks(container) {
    container.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const lat = parseFloat(item.getAttribute('data-lat'));
        const lng = parseFloat(item.getAttribute('data-lng'));
        const name = decodeURIComponent(item.getAttribute('data-name')).split(',').slice(0, 3).join(',');

        state.currentAddress = name;
        const input = document.getElementById('addressInput');
        if (input) input.value = name;

        setLocation(lat, lng, true);
        closeSuggestions();
      });
    });
  }

  function closeSuggestions() {
    const el = document.getElementById('searchSuggestions');
    if (el) el.hidden = true;
  }

  /* ============================================================
     11. KULLANICI ETKİLEŞİMİ VE OLAY DİNLEYİCİLERİ
     ============================================================ */
  function getCurrentGPSLocation() {
    if (!navigator.geolocation) {
      showToast('Tarayıcınız konum servisini desteklemiyor.', 'error');
      return;
    }

    showToast('GPS Konumunuz alınıyor…', 'info');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy;

        // Doğruluk çemberi
        if (accuracyCircle) map.removeLayer(accuracyCircle);
        if (acc && acc < 2000) {
          accuracyCircle = L.circle([lat, lng], {
            radius: acc,
            color: '#2563eb',
            weight: 1,
            fillColor: '#3b82f6',
            fillOpacity: 0.12
          }).addTo(map);
        }

        setLocation(lat, lng, true);
        reverseGeocode(lat, lng);
        showToast(`Konumunuz bulundu (±${Math.round(acc)}m).`, 'success');
      },
      (err) => {
        let msg = 'Konum alınamadı.';
        if (err.code === 1) msg = 'Konum izni reddedildi. Lütfen tarayıcı ayarlarından izin verin.';
        else if (err.code === 2) msg = 'Konum tespit edilemedi.';
        else if (err.code === 3) msg = 'Konum isteği zaman aşımına uğradı.';
        showToast(msg, 'error');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  function resetToDefault() {
    setLocation(DEFAULT_COORDS.lat, DEFAULT_COORDS.lng, true);
    state.currentAddress = DEFAULT_COORDS.name;
    const input = document.getElementById('addressInput');
    if (input) input.value = '';
    closeSuggestions();
    showToast('Uygulama varsayılana (İstanbul) sıfırlandı.', 'info');
  }

  function shareOrCopyResults() {
    const text = `🕋 KIBLE YÖNÜ VE MESAFE RAPORU
📍 Konum: ${state.currentAddress || 'Seçilen Nokta'} (${state.currentLat.toFixed(5)}°, ${state.currentLng.toFixed(5)}°)
🧭 Kıble Açısı: ${state.qiblaBearing.toFixed(2)}° (${get16PointDirectionName(state.qiblaBearing)})
📏 Kâbe'ye Kuş Uçuşu Mesafe: ${(state.distanceMeters / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km
☀️ Günün Kıble Saati: ${document.getElementById('qiblaHourText')?.textContent || '--:--'}
🔗 Kıble Bulucu: ${window.location.href}`;

    if (navigator.share) {
      navigator.share({
        title: 'Kıble Yönü & Kâbe Mesafesi',
        text: text,
        url: window.location.href
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Kıble bilgileri panoya kopyalandı! 📋', 'success');
      }).catch(() => {
        showToast('Kopyalama başarısız oldu.', 'error');
      });
    }
  }

  function toggleTheme() {
    state.isDark = !state.isDark;
    document.documentElement.setAttribute('data-theme', state.isDark ? 'dark' : 'light');
    localStorage.setItem('kible_theme', state.isDark ? 'dark' : 'light');

    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = state.isDark ? '☀️' : '🌙';

    // Karanlık modda gece harita katmanı tercih edilebilir
    if (state.isDark && state.currentLayerKey === 'osm') {
      setMapLayer('dark');
    } else if (!state.isDark && state.currentLayerKey === 'dark') {
      setMapLayer('osm');
    }
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem('kible_sound', state.soundEnabled ? '1' : '0');
    const btn = document.getElementById('soundToggle');
    if (btn) {
      btn.innerHTML = `<span class="icon">${state.soundEnabled ? '🔔' : '🔕'}</span>`;
      btn.title = state.soundEnabled ? 'Kıble Hiza Sesi (Açık)' : 'Kıble Hiza Sesi (Kapalı)';
    }
    showToast(state.soundEnabled ? 'Hizalanma sesi açıldı.' : 'Hizalanma sesi kapatıldı.', 'info');
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  /* ============================================================
     12. BAŞLATMA VE BAĞLANTILAR (INIT)
     ============================================================ */
  function initApp() {
    // 1. Temayı Yükle
    const savedTheme = localStorage.getItem('kible_theme');
    state.isDark = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', state.isDark ? 'dark' : 'light');
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) themeIcon.textContent = state.isDark ? '☀️' : '🌙';

    // 2. Ses Ayarını Yükle
    const savedSound = localStorage.getItem('kible_sound');
    state.soundEnabled = savedSound !== '0';
    const soundBtn = document.getElementById('soundToggle');
    if (soundBtn) {
      soundBtn.innerHTML = `<span class="icon">${state.soundEnabled ? '🔔' : '🔕'}</span>`;
    }

    // 3. Pusula Kadran Ticks Çizimi
    renderCompassTicks();

    // 4. Haritayı Başlat
    initMap();

    // 5. İlk Konum ve Hesaplamaları Yap
    setLocation(DEFAULT_COORDS.lat, DEFAULT_COORDS.lng, false);

    // 6. Akordiyon Dinleyicileri
    document.querySelectorAll('.feature-accordion .accordion-header').forEach(hdr => {
      hdr.addEventListener('click', () => {
        hdr.parentElement.classList.toggle('open');
      });
    });

    // 7. Arama Dinleyicileri
    const searchInput = document.getElementById('addressInput');
    const searchBtn = document.getElementById('searchBtn');
    const clearBtn = document.getElementById('clearSearchBtn');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (clearBtn) clearBtn.hidden = val.length === 0;

        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          fetchSuggestions(val);
        }, 320);
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          searchLocation(searchInput.value.trim());
        } else if (e.key === 'Escape') {
          closeSuggestions();
        }
      });
    }

    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        searchLocation(searchInput?.value.trim());
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        clearBtn.hidden = true;
        closeSuggestions();
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-section')) {
        closeSuggestions();
      }
    });

    // 8. Popüler Şehir Çipleri
    document.querySelectorAll('.city-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const lat = parseFloat(chip.getAttribute('data-lat'));
        const lng = parseFloat(chip.getAttribute('data-lng'));
        const name = chip.textContent.trim();

        document.querySelectorAll('.city-chips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        state.currentAddress = name;
        if (searchInput) searchInput.value = name;
        setLocation(lat, lng, true);
        showToast(`${name} seçildi.`, 'success');
      });
    });

    // 9. Pusula Mod Butonları
    document.getElementById('modeFixedBtn')?.addEventListener('click', () => setCompassMode('fixed'));
    document.getElementById('modeSensorBtn')?.addEventListener('click', () => setCompassMode('sensor'));

    // 10. Harita Kontrolleri Butonları
    document.getElementById('mapLayerOsm')?.addEventListener('click', () => setMapLayer('osm'));
    document.getElementById('mapLayerSatellite')?.addEventListener('click', () => setMapLayer('satellite'));
    document.getElementById('mapLayerDark')?.addEventListener('click', () => setMapLayer('dark'));

    document.getElementById('locateMeBtn')?.addEventListener('click', getCurrentGPSLocation);
    document.getElementById('locBtn')?.addEventListener('click', getCurrentGPSLocation);
    document.getElementById('fitBoundsBtn')?.addEventListener('click', fitKaabaAndUser);
    document.getElementById('zoomUserBtn')?.addEventListener('click', zoomToUserLocation);
    document.getElementById('flyKaabaBtn')?.addEventListener('click', flyToKaaba);
    document.getElementById('fullscreenBtn')?.addEventListener('click', toggleFullscreen);
    document.getElementById('resetBtn')?.addEventListener('click', resetToDefault);

    // 11. Paylaşma Butonları
    document.getElementById('shareBtn')?.addEventListener('click', shareOrCopyResults);
    document.getElementById('panelShareBtn')?.addEventListener('click', shareOrCopyResults);
    document.getElementById('badgeCopyBtn')?.addEventListener('click', shareOrCopyResults);

    // 12. Üst Menü Aksiyonları
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    document.getElementById('soundToggle')?.addEventListener('click', toggleSound);

    // 13. Modallar
    const guideModal = document.getElementById('guideModal');
    const guideBtn = document.getElementById('guideBtn');
    const closeGuideBtn = document.getElementById('closeGuideBtn');
    const gotItBtn = document.getElementById('gotItBtn');

    const openGuide = () => { if (guideModal) guideModal.hidden = false; };
    const closeGuide = () => { if (guideModal) guideModal.hidden = true; };

    guideBtn?.addEventListener('click', openGuide);
    closeGuideBtn?.addEventListener('click', closeGuide);
    gotItBtn?.addEventListener('click', closeGuide);

    const calibrateModal = document.getElementById('calibrateModal');
    const calibrateBtn = document.getElementById('calibrateBtn');
    const closeCalibrateBtn = document.getElementById('closeCalibrateBtn');
    const doneCalibrateBtn = document.getElementById('doneCalibrateBtn');

    calibrateBtn?.addEventListener('click', () => { if (calibrateModal) calibrateModal.hidden = false; });
    closeCalibrateBtn?.addEventListener('click', () => { if (calibrateModal) calibrateModal.hidden = true; });
    doneCalibrateBtn?.addEventListener('click', () => { if (calibrateModal) calibrateModal.hidden = true; });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeGuide();
        if (calibrateModal) calibrateModal.hidden = true;
      }
    });

    // 14. Mobil Sekmeler
    const tabs = document.querySelectorAll('.mobile-tabs .tab-btn');
    document.body.setAttribute('data-active-tab', 'compass-tab');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabKey = tab.getAttribute('data-tab');
        state.activeTab = tabKey;
        document.body.setAttribute('data-active-tab', tabKey);

        if (tabKey === 'map-tab' && map) {
          setTimeout(() => { map.invalidateSize(); }, 80);
        }
      });
    });

    // 15. Her Dakika Mekke Saati ve Vakitleri Tazele
    setInterval(() => {
      updateMeccaTime();
      updatePrayerTimes(new Date(), state.currentLat, state.currentLng);
    }, 60000);
  }

  // DOM Yüklendiğinde Başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();