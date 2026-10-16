# 🕌 Kıble Bulucu — Kâbe Yönü, Mesafe ve Canlı Pusula

Modern, yüksek hassasiyetli, uydu haritalı ve sensör destekli web tabanlı Kıble Bulucu uygulaması.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=for-the-badge&logo=Leaflet&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Ready-064e3b?style=for-the-badge)

---

## ✨ Özellikler

- **🕋 Yüksek Hassasiyetli Kâbe Açısı**: WGS84 standartlarında Kâbe koordinatları ($21.422487^\circ\text{ K}, 39.826206^\circ\text{ D}$) üzerinden Great-Circle Initial Bearing formülü ile milimetrik açı hesabı.
- **📏 Kuş Uçuşu Mesafe**: Haversine formülü ile Kâbe'ye olan tam mesafe (km ve mil).
- **🗺️ 3 Farklı Harita Katmanı (API Anahtarı Gerekmez)**:
  - **Sokak Haritası**: Esri World Street Map
  - **Uydu Haritası**: Esri World Imagery (Bina ve çatı hizalaması için)
  - **Gece Haritası**: Esri Dark Canvas
- **🧭 Canlı Dijital Pusula**:
  - **Sabit Kadran (Harita Modu)**: Kuzey yukarıda sabit, ibre Kâbe'yi gösterir.
  - **Canlı Sensör Modu**: Telefonun manyetik pusula sensörünü (DeviceOrientation) kullanarak cihaz döndükçe gerçek zamanlı hizalama sağlar.
  - **Haptik ve Sesli Geri Bildirim**: Kıble açısına gelindiğinde ($\pm 3^\circ$) titreşim ve uyarı tonu çalar.
- **☀️ Günün Kıble Saati**: Güneşin tam kıble azimutundan geçtiği dakika hesaplanır. Güneşle pusulasız kıble tayini sunar.
- **🕌 Astronomik Namaz Vakitleri**: Seçilen koordinat için o günün namaz vakitleri (İmsak, Güneş, Öğle, İkindi, Akşam, Yatsı) canlı olarak hesaplanır.
- **🔍 Akıllı Arama & Hızlı Şehirler**: Komoot Photon ve Nominatim çift motorlu adres arama, ters coğrafi kodlama ve popüler şehir butonları.
- **📱 PWA & Çevrimdışı Çalışma**: `manifest.json` ve `sw.js` (Service Worker) ile masaüstüne/telefona uygulama gibi yüklenebilir.
- **🎨 Zümrüt & Altın Tasarım**: Modern İslami estetik, koyu/açık tema desteği.

---

## 🚀 Kurulum & Çalıştırma

Projeyi herhangi bir sunucu kurmadan doğrudan tarayıcınızda açabilirsiniz:

1. Depoyu klonlayın veya indirin:
   ```bash
   git clone https://github.com/KULLANICI_ADINIZ/kible-bulucu.git
   cd kible-bulucu
   ```
2. `index.html` dosyasını çift tıklayarak tarayıcınızda açın veya yerel bir sunucu başlatın:
   ```bash
   npx serve .
   # veya
   python -m http.server 8080
   ```

---

## 🌐 GitHub Pages ile Ücretsiz Canlıya Alma

Bu depoyu GitHub Pages ile anında internette herkesin erişebileceği bir web sitesi yapabilirsiniz:

1. GitHub'da **Settings** (Ayarlar) sekmesine gidin.
2. Sol menüden **Pages** seçeneğine tıklayın.
3. **Branch** kısmında `main` (veya `master`) dalını ve `/ (root)` klasörünü seçip **Save** butonuna tıklayın.
4. Birkaç dakika içinde `https://KULLANICI_ADINIZ.github.io/REPO_ADINIZ` adresinde siteniz canlı yayına girecektir.

---

## 📄 Lisans

Bu proje açık kaynaklıdır ve MIT lisansı altında paylaşılmıştır.
