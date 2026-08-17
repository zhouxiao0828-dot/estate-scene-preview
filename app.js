const regions = [
  { id: 'dock', name: '私人码头', x: 43, y: 26, icon: 'anchor', image: 'assets/dock.png', video: 'assets/dock.mov' },
  { id: 'treehouse', name: '树屋乐园', x: 72, y: 31, icon: 'trees', image: 'assets/treehouse.png', video: 'assets/treehouse.mov' },
  { id: 'bbq', name: '烧烤野餐', x: 52, y: 41, icon: 'cooking-pot', image: 'assets/bbq.png', video: 'assets/bbq.mov' },
  { id: 'pool', name: '泳池', x: 34, y: 53, icon: 'waves', image: 'assets/pool.png', video: 'assets/pool.mov' },
  { id: 'greenhouse', name: '玻璃花房', x: 20, y: 67, icon: 'flower-2', image: 'assets/greenhouse.png', video: 'assets/greenhouse.mov' },
  { id: 'house', name: '主住宅', x: 72, y: 67, icon: 'house', image: 'assets/house.png', video: 'assets/house.mov' }
];

const DB_NAME = 'estate-transition-assets';
const DB_VERSION = 1;
const STORE_NAME = 'files';

const app = document.getElementById('app');
const mapView = document.getElementById('mapView');
const mapImage = document.getElementById('mapImage');
const hotspots = document.getElementById('hotspots');
const videoView = document.getElementById('videoView');
const transitionVideo = document.getElementById('transitionVideo');
const detailView = document.getElementById('detailView');
const detailImage = document.getElementById('detailImage');
const detailTitle = document.getElementById('detailTitle');
const transitionMask = document.getElementById('transitionMask');
const settingsButton = document.getElementById('settingsButton');
const assetDialog = document.getElementById('assetDialog');
const assetList = document.getElementById('assetList');
const mapInput = document.getElementById('mapInput');
const mapStatus = document.getElementById('mapStatus');
const backButton = document.getElementById('backButton');
const skipButton = document.getElementById('skipButton');
const resetButton = document.getElementById('resetButton');

let database;
let activeRegion = null;
let transitionBusy = false;
let currentVideoUrl = '';
const imageUrls = new Map();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getStoredFile(key) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function saveStoredFile(key, file) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(file, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStoredFiles() {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function revokeUrl(key) {
  const url = imageUrls.get(key);
  if (url) URL.revokeObjectURL(url);
  imageUrls.delete(key);
}

async function imageSource(region) {
  const key = `${region.id}:image`;
  const stored = await getStoredFile(key);
  if (!stored) return region.image;
  revokeUrl(key);
  const url = URL.createObjectURL(stored);
  imageUrls.set(key, url);
  return url;
}

function flashMask() {
  transitionMask.classList.remove('is-active');
  void transitionMask.offsetWidth;
  transitionMask.classList.add('is-active');
}

function createHotspots() {
  regions.forEach((region) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hotspot';
    button.style.left = `${region.x}%`;
    button.style.top = `${region.y}%`;
    button.setAttribute('aria-label', `进入${region.name}`);
    button.innerHTML = `<span class="hotspot-dot"><i data-lucide="${region.icon}" aria-hidden="true"></i></span>`;
    button.addEventListener('click', () => enterRegion(region));
    hotspots.appendChild(button);
  });
  lucide.createIcons({ attrs: { width: 24, height: 24, 'stroke-width': 2.5 } });
}

function createAssetRows() {
  regions.forEach((region) => {
    const row = document.createElement('section');
    row.className = 'asset-row';
    row.innerHTML = `
      <div class="asset-info">
        <strong>${region.name}</strong>
        <span><span id="${region.id}ImageStatus">默认图片</span> · <span id="${region.id}VideoStatus">待配置视频</span></span>
      </div>
      <div class="asset-actions">
        <label class="file-button">替换图片<input type="file" accept="image/*" data-kind="image" data-region="${region.id}"></label>
        <label class="file-button">选择视频<input type="file" accept="video/*" data-kind="video" data-region="${region.id}"></label>
      </div>`;
    assetList.appendChild(row);
  });

  assetList.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', handleRegionFile);
  });
}

async function refreshStatuses() {
  const customMap = await getStoredFile('map:image');
  mapStatus.textContent = customMap ? '已替换图片' : '默认图片';

  for (const region of regions) {
    const image = await getStoredFile(`${region.id}:image`);
    const video = await getStoredFile(`${region.id}:video`);
    document.getElementById(`${region.id}ImageStatus`).textContent = image ? '已替换图片' : '默认图片';
    document.getElementById(`${region.id}VideoStatus`).textContent = video ? '已配置视频' : '待配置视频';
  }
}

async function loadMapImage() {
  const stored = await getStoredFile('map:image');
  revokeUrl('map:image');
  if (!stored) {
    mapImage.src = 'assets/estate-map.jpg';
    return;
  }
  const url = URL.createObjectURL(stored);
  imageUrls.set('map:image', url);
  mapImage.src = url;
}

async function handleRegionFile(event) {
  const input = event.currentTarget;
  const file = input.files && input.files[0];
  if (!file) return;
  const regionId = input.dataset.region;
  const kind = input.dataset.kind;
  await saveStoredFile(`${regionId}:${kind}`, file);
  await refreshStatuses();
  input.value = '';
}

async function enterRegion(region) {
  if (transitionBusy) return;
  transitionBusy = true;
  activeRegion = region;
  settingsButton.hidden = true;
  mapView.style.setProperty('--zoom-x', `${region.x}%`);
  mapView.style.setProperty('--zoom-y', `${region.y}%`);
  mapView.classList.add('is-zoomed');

  const videoFile = await getStoredFile(`${region.id}:video`);
  if (videoFile || region.video) {
    window.setTimeout(() => playTransitionVideo(videoFile || region.video), 520);
  } else {
    window.setTimeout(showDetail, 720);
  }
}

async function playTransitionVideo(source) {
  if (currentVideoUrl) URL.revokeObjectURL(currentVideoUrl);
  if (typeof source === 'string') {
    currentVideoUrl = '';
    transitionVideo.src = source;
  } else {
    currentVideoUrl = URL.createObjectURL(source);
    transitionVideo.src = currentVideoUrl;
  }
  transitionVideo.currentTime = 0;
  videoView.classList.add('is-visible');
  videoView.setAttribute('aria-hidden', 'false');
  flashMask();
  try {
    await transitionVideo.play();
  } catch {
    showDetail();
  }
}

async function showDetail() {
  if (!activeRegion) return;
  transitionVideo.pause();
  detailImage.src = await imageSource(activeRegion);
  detailImage.alt = `${activeRegion.name}区域图`;
  detailTitle.textContent = activeRegion.name;
  flashMask();
  detailView.classList.add('is-visible');
  detailView.setAttribute('aria-hidden', 'false');
  videoView.classList.remove('is-visible');
  videoView.setAttribute('aria-hidden', 'true');
  mapView.classList.add('is-hidden');
  transitionBusy = false;
  backButton.focus();
}

function returnToMap() {
  if (transitionBusy) return;
  transitionBusy = true;
  flashMask();
  detailView.classList.remove('is-visible');
  detailView.setAttribute('aria-hidden', 'true');
  videoView.classList.remove('is-visible');
  videoView.setAttribute('aria-hidden', 'true');
  transitionVideo.pause();
  mapView.classList.remove('is-hidden');
  window.setTimeout(() => mapView.classList.remove('is-zoomed'), 220);
  window.setTimeout(() => {
    activeRegion = null;
    settingsButton.hidden = false;
    transitionBusy = false;
  }, 880);
}

transitionVideo.addEventListener('ended', showDetail);
transitionVideo.addEventListener('error', showDetail);
skipButton.addEventListener('click', showDetail);
backButton.addEventListener('click', returnToMap);
settingsButton.addEventListener('click', () => assetDialog.showModal());

mapInput.addEventListener('change', async () => {
  const file = mapInput.files && mapInput.files[0];
  if (!file) return;
  await saveStoredFile('map:image', file);
  await loadMapImage();
  await refreshStatuses();
  mapInput.value = '';
});

resetButton.addEventListener('click', async () => {
  await clearStoredFiles();
  for (const key of imageUrls.keys()) revokeUrl(key);
  await loadMapImage();
  await refreshStatuses();
});

async function initialize() {
  database = await openDatabase();
  createHotspots();
  createAssetRows();
  await loadMapImage();
  await refreshStatuses();
}

initialize();
