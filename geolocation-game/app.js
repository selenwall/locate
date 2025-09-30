/* Geolocation Game - Based on hitta repository */
(() => {
  // Wait for all scripts to load before starting
  function waitForScripts() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50;
      
      const checkScripts = () => {
        attempts++;
        if (typeof ml5 !== 'undefined' || typeof cocoSsd !== 'undefined') {
          console.log('Scripts loaded after', attempts * 100, 'ms');
          resolve();
        } else if (attempts >= maxAttempts) {
          console.warn('Timeout loading scripts');
          reject(new Error('Scripts did not load within 5 seconds. Check your internet connection.'));
        } else {
          setTimeout(checkScripts, 100);
        }
      };
      checkScripts();
    });
  }

  // Game state management
  const DEFAULT_GAME = {
    playerAName: '',
    playerBName: '',
    playerAScore: 0,
    playerBScore: 0,
    currentPlayer: 'A', // A takes photo, B hunts
    targetObjects: [],
    targetLocation: null,
    isActive: false,
    winner: '',
    winPoints: 5,
    canceledBy: '',
    gameId: '',
    huntStartTime: null,
    huntTimeLimit: 180, // 3 minutes
  };

  const WIN_POINTS = 5;
  const HUNT_TIME_LIMIT = 180; // 3 minutes
  const MIN_SCORE = 0.6;
  const PROXIMITY_THRESHOLD = 5; // 5 meters

  let game = { ...DEFAULT_GAME };
  let yoloModel = null;
  let mediaStream = null;
  let timerInterval = null;
  let secondsLeft = HUNT_TIME_LIMIT;
  let activeRAF = 0;
  let liveDetectInterval = null;
  let liveDetectInProgress = false;
  let roundAwarded = false;
  let watchId = null;
  let currentLocation = null;
  const translateCache = new Map();
  const inflightTranslate = new Map();

  // Swedish translations for COCO-SSD labels (same as hitta)
  const COCO_SV = {
    person: 'person',
    bicycle: 'cykel',
    car: 'bil',
    motorcycle: 'motorcykel',
    airplane: 'flygplan',
    bus: 'buss',
    train: 'tåg',
    truck: 'lastbil',
    boat: 'båt',
    'traffic light': 'trafikljus',
    'fire hydrant': 'brandpost',
    'stop sign': 'stoppskylt',
    'parking meter': 'parkeringsautomat',
    bench: 'bänk',
    bird: 'fågel',
    cat: 'katt',
    dog: 'hund',
    horse: 'häst',
    sheep: 'får',
    cow: 'ko',
    elephant: 'elefant',
    bear: 'björn',
    zebra: 'zebra',
    giraffe: 'giraff',
    backpack: 'ryggsäck',
    umbrella: 'paraply',
    handbag: 'handväska',
    tie: 'slips',
    suitcase: 'resväska',
    frisbee: 'frisbee',
    skis: 'skidor',
    snowboard: 'snowboard',
    'sports ball': 'boll',
    kite: 'drake',
    'baseball bat': 'basebollträ',
    'baseball glove': 'basebollhandske',
    skateboard: 'skateboard',
    surfboard: 'surfbräda',
    'tennis racket': 'tennisracket',
    bottle: 'flaska',
    'wine glass': 'vinglas',
    cup: 'kopp',
    fork: 'gaffel',
    knife: 'kniv',
    spoon: 'sked',
    bowl: 'skål',
    banana: 'banan',
    apple: 'äpple',
    sandwich: 'smörgås',
    orange: 'apelsin',
    broccoli: 'broccoli',
    carrot: 'morot',
    'hot dog': 'varmkorv',
    pizza: 'pizza',
    donut: 'munk',
    cake: 'tårta',
    chair: 'stol',
    couch: 'soffa',
    'potted plant': 'krukväxt',
    bed: 'säng',
    'dining table': 'matbord',
    toilet: 'toalett',
    tv: 'tv',
    laptop: 'laptop',
    mouse: 'mus',
    remote: 'fjärrkontroll',
    keyboard: 'tangentbord',
    'cell phone': 'mobiltelefon',
    microwave: 'mikrovågsugn',
    oven: 'ugn',
    toaster: 'brödrost',
    sink: 'diskho',
    refrigerator: 'kylskåp',
    book: 'bok',
    clock: 'klocka',
    vase: 'vas',
    scissors: 'sax',
    'teddy bear': 'nallebjörn',
    'hair drier': 'hårtork',
    toothbrush: 'tandborste',
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const scoreBar = $('#scoreBar');
  const screens = {
    home: $('#screen-home'),
    capture: $('#screen-capture'),
    wait: $('#screen-wait'),
    hunt: $('#screen-hunt'),
    win: $('#screen-win'),
  };

  function setScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // URL state management (same as hitta)
  function encodeStateToURL(next) {
    const url = new URL(location.href);
    const params = url.searchParams;
    params.set('pa', next.playerAName || '');
    params.set('pb', next.playerBName || '');
    params.set('sa', String(next.playerAScore || 0));
    params.set('sb', String(next.playerBScore || 0));
    params.set('cp', next.currentPlayer || 'A');
    params.set('objs', JSON.stringify(next.targetObjects || []));
    params.set('lat', String(next.targetLocation?.latitude || ''));
    params.set('lng', String(next.targetLocation?.longitude || ''));
    params.set('act', next.isActive ? '1' : '0');
    params.set('w', next.winner || '');
    params.set('wp', String(next.winPoints || WIN_POINTS));
    params.set('cx', next.canceledBy || '');
    params.set('gid', next.gameId || '');
    history.replaceState({}, '', url);
  }

  function decodeStateFromURL() {
    const url = new URL(location.href);
    const p = url.searchParams;
    const parsed = {
      playerAName: p.get('pa') || '',
      playerBName: p.get('pb') || '',
      playerAScore: parseInt(p.get('sa') || '0', 10) || 0,
      playerBScore: parseInt(p.get('sb') || '0', 10) || 0,
      currentPlayer: (p.get('cp') || 'A') === 'B' ? 'B' : 'A',
      targetObjects: JSON.parse(p.get('objs') || '[]'),
      targetLocation: p.get('lat') && p.get('lng') ? {
        latitude: parseFloat(p.get('lat')),
        longitude: parseFloat(p.get('lng'))
      } : null,
      isActive: p.get('act') === '1',
      winner: p.get('w') || '',
      winPoints: parseInt(p.get('wp') || String(WIN_POINTS), 10) || WIN_POINTS,
      canceledBy: p.get('cx') || '',
      gameId: p.get('gid') || '',
    };
    return { ...DEFAULT_GAME, ...parsed };
  }

  function updateScoreBar() {
    const aName = game.playerAName || 'Spelare A';
    const bName = game.playerBName || 'Spelare B';
    const active = game.isActive ? (game.currentPlayer === 'A' ? 'A' : 'B') : '';
    const aClass = active === 'A' ? 'badge active' : 'badge';
    const bClass = active === 'B' ? 'badge active' : 'badge';
    scoreBar.innerHTML = `
      <span class="${aClass}">${aName}<span class="vs"> ${game.playerAScore}</span></span>
      <span class="vs">vs</span>
      <span class="${bClass}"><span class="vs">${game.playerBScore} </span>${bName}</span>
    `;
  }

  // Geolocation functions
  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          let message = 'Could not get location. ';
          switch(error.code) {
            case error.PERMISSION_DENIED:
              message += 'Location access denied. Please allow location access.';
              break;
            case error.POSITION_UNAVAILABLE:
              message += 'Location information unavailable.';
              break;
            case error.TIMEOUT:
              message += 'Location request timed out.';
              break;
            default:
              message += 'Unknown error occurred.';
              break;
          }
          reject(new Error(message));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  function startLocationWatch(callback) {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        callback(currentLocation);
      },
      (error) => {
        console.error('Location watch error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 1000
      }
    );
  }

  function stopLocationWatch() {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  }

  function getDistanceClass(distance) {
    if (distance <= PROXIMITY_THRESHOLD) return 'very-close';
    if (distance <= 20) return 'close';
    if (distance <= 50) return 'far';
    return 'far';
  }

  // Camera and AI functions (adapted from hitta)
  function stopCamera() {
    if (liveDetectInterval) {
      clearInterval(liveDetectInterval);
      liveDetectInterval = null;
    }
    liveDetectInProgress = false;
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  async function startCamera(videoEl, facingMode = 'environment') {
    stopCamera();
    
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      console.log('Requesting camera permissions...');
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (!mediaStream) {
        throw new Error('No media stream received');
      }

      videoEl.srcObject = mediaStream;
      
      return new Promise((resolve, reject) => {
        videoEl.onloadedmetadata = () => {
          videoEl.play()
            .then(() => {
              console.log('Camera started successfully');
              resolve();
            })
            .catch(reject);
        };
        
        videoEl.onerror = (error) => {
          console.error('Video error:', error);
          reject(new Error('Could not play video'));
        };
      });
      
    } catch (error) {
      console.error('Camera error:', error);
      
      let errorMessage = 'Could not start camera. ';
      
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Camera permission denied. Click the camera icon in the address bar and allow camera access.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No camera found. Check that a camera is connected.';
      } else if (error.name === 'NotReadableError') {
        errorMessage += 'Camera is being used by another application. Close other apps using the camera.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage += 'Camera settings not supported. Try with a different camera.';
      } else {
        errorMessage += `Error: ${error.message}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  async function detectObjects(model, input) {
    if (model.detect && typeof model.detect === 'function' && model.detect.length === 2) {
      return new Promise((resolve, reject) => {
        model.detect(input, (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        });
      });
    } else {
      return await model.detect(input);
    }
  }

  async function loadModel() {
    if (!yoloModel) {
      console.log('Loading object detection model...');
      
      await waitForScripts();
      
      if (typeof ml5 !== 'undefined' && ml5.objectDetector) {
        try {
          console.log('Loading YOLO model...');
          yoloModel = await ml5.objectDetector('YOLO', { 
            filterBoxesThreshold: 0.01,
            IOUThreshold: 0.4,
            classProbThreshold: MIN_SCORE
          });
          console.log('YOLO model loaded successfully');
          return yoloModel;
        } catch (error) {
          console.warn('YOLO model failed, trying COCO-SSD:', error);
        }
      } else {
        console.warn('ml5.js not available, trying COCO-SSD');
      }
      
      if (typeof cocoSsd !== 'undefined') {
        try {
          console.log('Loading COCO-SSD model as fallback...');
          yoloModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
          console.log('COCO-SSD model loaded successfully');
          return yoloModel;
        } catch (error) {
          console.error('COCO-SSD model failed:', error);
        }
      }
      
      throw new Error('Could not load any object detection model. Check your internet connection and reload the page.');
    }
    return yoloModel;
  }

  async function translateLabelToSv(label) {
    try {
      const key = (label || '').trim().toLowerCase();
      if (!key) return Promise.resolve(label);
      if (translateCache.has(key)) return Promise.resolve(translateCache.get(key));
      if (COCO_SV[key]) {
        const mapped = COCO_SV[key];
        translateCache.set(key, mapped);
        return Promise.resolve(mapped);
      }
      if (inflightTranslate.has(key)) return inflightTranslate.get(key);
      const p = fetch('https://libretranslate.com/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: key, source: 'en', target: 'sv', format: 'text' }),
      }).then(r => r.json()).then(j => {
        const out = (j && j.translatedText) ? j.translatedText : label;
        translateCache.set(key, out);
        inflightTranslate.delete(key);
        return out;
      }).catch(() => {
        inflightTranslate.delete(key);
        return label;
      });
      inflightTranslate.set(key, p);
      return p;
    } catch {
      return Promise.resolve(label);
    }
  }

  // Timer functions
  function resetTimer(seconds = HUNT_TIME_LIMIT) {
    clearInterval(timerInterval);
    secondsLeft = seconds;
    $('#hunt-timer')?.replaceChildren(document.createTextNode(formatTime(secondsLeft)));
  }

  function startTimer(onExpire) {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      secondsLeft -= 1;
      const el = $('#hunt-timer');
      if (el) el.textContent = formatTime(secondsLeft);
      if (secondsLeft <= 0) {
        clearInterval(timerInterval);
        onExpire?.();
      }
    }, 1000);
  }

  function formatTime(total) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function calculateScore(timeElapsed) {
    if (timeElapsed <= 60) return 3; // 1 minute
    if (timeElapsed <= 120) return 2; // 2 minutes
    if (timeElapsed <= 180) return 1; // 3 minutes
    return 0;
  }

  function checkWinner() {
    const target = game.winPoints || WIN_POINTS;
    if (game.playerAScore >= target) return 'A';
    if (game.playerBScore >= target) return 'B';
    return '';
  }

  function showFeedback(score) {
    const node = document.createElement('div');
    node.className = 'feedback';
    node.innerHTML = `🎯 <span class="plus">+${score}</span>`;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 3000);
  }

  // Screen rendering functions
  function renderHome() {
    updateScoreBar();
    setScreen('home');
    const hasActive = game.isActive;
    screens.home.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'col card';

    const title = document.createElement('h2');
    title.textContent = 'Geolocation Game - Hitta platsen!';
    wrap.appendChild(title);

    const description = document.createElement('div');
    description.className = 'hint';
    description.innerHTML = '📸 <strong>Spelregler:</strong> En spelare tar en bild, AI identifierar objekt, den andra spelaren har 3 minuter att hitta platsen inom 5 meter. 3 poäng på 1 minut, 2 poäng på 2 minuter, 1 poäng på 3 minuter.';
    wrap.appendChild(description);

    const locationInfo = document.createElement('div');
    locationInfo.className = 'hint';
    locationInfo.innerHTML = '📍 <strong>Platsbehörigheter krävs!</strong> Spelet behöver tillgång till din plats för att fungera.';
    wrap.appendChild(locationInfo);

    const nameRow = document.createElement('div');
    nameRow.className = 'col';

    const nameA = document.createElement('input');
    nameA.placeholder = 'Ditt namn';
    nameA.value = game.playerAName || '';
    nameA.autocapitalize = 'words';
    nameA.autocomplete = 'name';

    const nameB = document.createElement('input');
    nameB.placeholder = 'Motspelarens namn (om du startar)';
    nameB.value = game.playerBName || '';

    nameRow.appendChild(nameA);
    nameRow.appendChild(nameB);
    wrap.appendChild(nameRow);

    const roundsRow = document.createElement('div');
    roundsRow.className = 'row';
    const roundsLabel = document.createElement('label');
    roundsLabel.textContent = 'Spelomgångar (först till):';
    const rounds = document.createElement('select');
    [1,3,5].forEach(n => {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      if ((game.winPoints || WIN_POINTS) === n) opt.selected = true;
      rounds.appendChild(opt);
    });
    rounds.onchange = () => {
      const val = parseInt(rounds.value, 10) || WIN_POINTS;
      game.winPoints = val;
      encodeStateToURL(game);
      updateScoreBar();
    };
    roundsRow.appendChild(roundsLabel);
    roundsRow.appendChild(rounds);
    if (!hasActive) {
      wrap.appendChild(roundsRow);
    }

    const startBtn = document.createElement('button');
    startBtn.className = 'primary';
    startBtn.textContent = 'Starta nytt spel';
    startBtn.onclick = async () => {
      try {
        // Get location permission first
        await getCurrentPosition();
        
        const gid = Math.random().toString(36).slice(2, 10);
        try { localStorage.setItem('geolocation_owner_gid', gid); } catch {}
        game = {
          ...game,
          playerAName: nameA.value.trim() || 'Spelare A',
          playerBName: nameB.value.trim() || 'Spelare B',
          playerAScore: 0,
          playerBScore: 0,
          currentPlayer: 'A',
          targetObjects: [],
          targetLocation: null,
          isActive: true,
          winner: '',
          winPoints: parseInt(rounds.value, 10) || (game.winPoints || WIN_POINTS),
          canceledBy: '',
          gameId: gid,
        };
        encodeStateToURL(game);
        renderCapture();
      } catch (error) {
        alert('Location access required: ' + error.message);
      }
    };

    const joinBtn = document.createElement('button');
    joinBtn.className = 'ghost';
    joinBtn.textContent = hasActive ? 'Fortsätt' : 'Gå med i spel via länk';
    joinBtn.onclick = async () => {
      try {
        await getCurrentPosition();
        
        if (!hasActive) {
          game.playerBName = nameA.value.trim() || game.playerBName || 'Spelare B';
          game.playerAName = game.playerAName || 'Spelare A';
          game.isActive = true;
          encodeStateToURL(game);
        }
        if (game.targetObjects.length > 0) renderHunt(); else renderCapture();
      } catch (error) {
        alert('Location access required: ' + error.message);
      }
    };

    wrap.appendChild(startBtn);
    wrap.appendChild(joinBtn);
    screens.home.appendChild(wrap);
  }

  function renderCapture() {
    updateScoreBar();
    setScreen('capture');
    stopCamera();
    screens.capture.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'col';
    
    const instruction = document.createElement('div');
    instruction.className = 'pill';
    instruction.textContent = 'Fotografera objekt som hjälper motspelaren att hitta platsen';
    container.appendChild(instruction);

    const vw = document.createElement('div');
    vw.className = 'video-wrap';
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    const canvas = document.createElement('canvas');
    canvas.style.display = 'none';
    const overlay = document.createElement('div');
    overlay.className = 'overlay boxes';
    vw.appendChild(video);
    vw.appendChild(canvas);
    vw.appendChild(overlay);
    container.appendChild(vw);

    const actions = document.createElement('div');
    actions.className = 'footer-actions';
    const snap = document.createElement('button');
    snap.className = 'primary';
    snap.textContent = 'Ta bild och skicka utmaning';
    
    const isOwner = (() => { try { return game.gameId && localStorage.getItem('geolocation_owner_gid') === game.gameId; } catch { return false; } })();
    if (isOwner) {
      const cancel = document.createElement('button');
      cancel.className = 'danger';
      cancel.textContent = 'Avbryt spel';
      cancel.onclick = () => {
        game.isActive = false;
        game.canceledBy = game.playerAName || 'Spelare A';
        encodeStateToURL(game);
        renderCancel();
      };
      actions.appendChild(cancel);
    }
    actions.appendChild(snap);
    container.appendChild(actions);

    screens.capture.appendChild(container);

    const ctx = canvas.getContext('2d');

    const drawLiveBoxes = (preds) => {
      overlay.classList.remove('interactive');
      overlay.innerHTML = '';
      const vwRect = vw.getBoundingClientRect();
      const scaleX = vwRect.width && video.videoWidth ? vwRect.width / video.videoWidth : 1;
      const scaleY = vwRect.height && video.videoHeight ? vwRect.height / video.videoHeight : 1;
      const list = (preds || []).filter(p => (p.confidence || p.score) > MIN_SCORE);
      list.forEach((p) => {
        let x, y, w, h;
        if (p.bbox && Array.isArray(p.bbox)) {
          [x, y, w, h] = p.bbox;
        } else {
          x = p.x;
          y = p.y;
          w = p.width;
          h = p.height;
        }
        const b = document.createElement('div');
        b.className = 'box';
        b.style.left = `${x * scaleX}px`;
        b.style.top = `${y * scaleY}px`;
        b.style.width = `${w * scaleX}px`;
        b.style.height = `${h * scaleY}px`;
        const lab = document.createElement('label');
        const label = p.label || p.class || '';
        const confidence = p.confidence || p.score || 0;
        lab.textContent = `${label.toUpperCase()} ${(confidence*100).toFixed(0)}%`;
        translateLabelToSv(label).then(sv => { lab.textContent = `${(sv || '').toUpperCase()} ${(confidence*100).toFixed(0)}%`; }).catch(() => {});
        b.appendChild(lab);
        overlay.appendChild(b);
      });
    };

    startCamera(video).then(loadModel).then(() => {
      stopLiveDetect();
      liveDetectInterval = setInterval(async () => {
        if (liveDetectInProgress) return;
        if (!yoloModel) return;
        if (video.readyState < 2) return;
        try {
          liveDetectInProgress = true;
          const preds = await detectObjects(yoloModel, video);
          drawLiveBoxes(preds);
        } catch (e) {
          // ignore transient errors
        } finally {
          liveDetectInProgress = false;
        }
      }, 600);
    }).catch(err => {
      console.error('Camera start error:', err);
      alert(err.message || 'Could not start camera. Grant camera permission and try again.');
      setScreen('home');
    });

    snap.onclick = async () => {
      try {
        stopLiveDetect();
        const model = await loadModel();
        
        // Get current location
        const location = await getCurrentPosition();
        
        // Capture photo
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        video.style.display = 'none';
        canvas.style.display = 'block';
        
        const allPreds = await detectObjects(model, canvas);
        const preds = (allPreds || []).filter(p => (p.confidence || p.score) > MIN_SCORE);
        
        stopCamera();
        
        if (!preds.length) {
          alert('No objects over 60% found. Try again.');
          return;
        }

        // Store game data
        game.targetObjects = preds.map(p => ({
          label: p.label || p.class || '',
          confidence: p.confidence || p.score || 0
        }));
        game.targetLocation = location;
        game.currentPlayer = game.currentPlayer === 'A' ? 'B' : 'A';
        game.huntStartTime = Date.now();
        game.isActive = true;
        game.winner = '';
        encodeStateToURL(game);

        // Create share message
        const objectNames = game.targetObjects.map(obj => obj.label).join(', ');
        const svNames = await Promise.all(game.targetObjects.map(obj => translateLabelToSv(obj.label)));
        const svText = svNames.join(', ').toUpperCase();
        
        const text = `${game.playerAName} utmanar ${game.playerBName} att hitta platsen med objekten: ${svText}. Ställning ${game.playerAScore}-${game.playerBScore}.`;
        
        // Share link
        const url = location.href;
        const full = `${text} ${url}`.trim();
        if (navigator.share) {
          navigator.share({ title: 'Geolocation Game Challenge', text, url }).catch(() => {});
        } else {
          const sms = `sms:?&body=${encodeURIComponent(full)}`;
          const opened = window.open(sms, '_blank');
          if (!opened && navigator.clipboard?.writeText) {
            try { await navigator.clipboard.writeText(full); alert('Link copied. Paste in any app.'); } catch {}
          }
        }
        
        renderWait();
      } catch (e) {
        console.error(e);
        alert('Could not analyze image or get location.');
      }
    };
  }

  function renderWait() {
    updateScoreBar();
    setScreen('wait');
    stopCamera();
    screens.wait.innerHTML = '';
    const c = document.createElement('div');
    c.className = 'center card';
    
    const info = document.createElement('div');
    const objectNames = game.targetObjects.map(obj => obj.label).join(', ');
    info.innerHTML = `<div>Delad utmaning med objekten: <span class="name">${objectNames.toUpperCase()}</span></div>`;
    
    // Update with Swedish translation
    Promise.all(game.targetObjects.map(obj => translateLabelToSv(obj.label))).then(svNames => {
      const span = info.querySelector('.name');
      if (span) span.textContent = svNames.join(', ').toUpperCase();
    }).catch(() => {});
    
    const tip = document.createElement('div');
    tip.className = 'hint';
    tip.textContent = 'Väntar på att motspelaren ska hitta platsen. Dela länken om du inte gjort det.';
    
    const back = document.createElement('button');
    back.className = 'ghost';
    back.textContent = 'Till startsidan';
    back.onclick = () => renderHome();
    
    const isOwner = (() => { try { return game.gameId && localStorage.getItem('geolocation_owner_gid') === game.gameId; } catch { return false; } })();
    if (isOwner) {
      const cancel = document.createElement('button');
      cancel.className = 'danger';
      cancel.textContent = 'Avbryt spel';
      cancel.onclick = () => {
        game.isActive = false;
        game.canceledBy = game.playerAName || 'Spelare A';
        encodeStateToURL(game);
        renderCancel();
      };
      c.appendChild(cancel);
    }
    
    c.appendChild(info);
    c.appendChild(tip);
    c.appendChild(back);
    screens.wait.appendChild(c);
  }

  function renderHunt() {
    updateScoreBar();
    setScreen('hunt');
    stopCamera();
    screens.hunt.innerHTML = '';
    roundAwarded = false;
    
    const container = document.createElement('div');
    container.className = 'col';
    
    const pill = document.createElement('div');
    pill.className = 'pill';
    const objectNames = game.targetObjects.map(obj => obj.label).join(', ');
    pill.innerHTML = `<span>Hitta platsen med objekten: <span class="name">${objectNames.toUpperCase()}</span></span>`;
    
    // Update with Swedish translation
    Promise.all(game.targetObjects.map(obj => translateLabelToSv(obj.label))).then(svNames => {
      const span = pill.querySelector('.name');
      if (span) span.textContent = svNames.join(', ').toUpperCase();
    }).catch(() => {});
    
    container.appendChild(pill);

    // Location info display
    const locationInfo = document.createElement('div');
    locationInfo.className = 'location-info';
    locationInfo.innerHTML = `
      <div>Avstånd till målet: <span id="distance" class="distance">Beräknar...</span></div>
      <div class="progress-bar">
        <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
      </div>
      <div class="hint">Du har 3 minuter att hitta platsen inom 5 meter!</div>
    `;
    container.appendChild(locationInfo);

    const actions = document.createElement('div');
    actions.className = 'footer-actions';
    const timer = document.createElement('div');
    timer.className = 'pill timer';
    timer.id = 'hunt-timer';
    timer.textContent = formatTime(HUNT_TIME_LIMIT);
    
    const giveUp = document.createElement('button');
    giveUp.className = 'ghost';
    giveUp.textContent = 'Ge upp';
    
    const isOwner = (() => { try { return game.gameId && localStorage.getItem('geolocation_owner_gid') === game.gameId; } catch { return false; } })();
    if (isOwner) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'danger';
      cancelBtn.textContent = 'Avbryt spel';
      cancelBtn.onclick = () => {
        clearInterval(timerInterval);
        stopLocationWatch();
        game.isActive = false;
        game.canceledBy = game.playerAName || 'Spelare A';
        encodeStateToURL(game);
        renderCancel();
      };
      actions.appendChild(cancelBtn);
    }
    
    actions.appendChild(timer);
    actions.appendChild(giveUp);
    container.appendChild(actions);

    screens.hunt.appendChild(container);

    // Start location tracking
    resetTimer();
    startTimer(() => {
      stopLocationWatch();
      finishRound(false);
    });

    startLocationWatch((location) => {
      if (!game.targetLocation) return;
      
      const distance = calculateDistance(
        location.latitude, location.longitude,
        game.targetLocation.latitude, game.targetLocation.longitude
      );
      
      const distanceEl = $('#distance');
      const progressEl = $('#progress-fill');
      
      if (distanceEl) {
        distanceEl.textContent = `${distance.toFixed(1)} meter`;
        distanceEl.className = `distance ${getDistanceClass(distance)}`;
      }
      
      if (progressEl) {
        const progress = Math.min(100, (PROXIMITY_THRESHOLD / Math.max(distance, 1)) * 100);
        progressEl.style.width = `${progress}%`;
      }
      
      // Check if player reached the target
      if (distance <= PROXIMITY_THRESHOLD && !roundAwarded) {
        roundAwarded = true;
        const timeElapsed = (Date.now() - game.huntStartTime) / 1000;
        const score = calculateScore(timeElapsed);
        
        if (game.currentPlayer === 'A') {
          game.playerBScore += score;
        } else {
          game.playerAScore += score;
        }
        
        updateScoreBar();
        showFeedback(score);
        
        clearInterval(timerInterval);
        stopLocationWatch();
        
        setTimeout(() => {
          finishRound(true);
        }, 2000);
      }
    });

    giveUp.onclick = () => {
      clearInterval(timerInterval);
      stopLocationWatch();
      finishRound(false);
    };
  }

  function finishRound(success) {
    // Switch players
    game.currentPlayer = game.currentPlayer === 'A' ? 'B' : 'A';
    game.targetObjects = [];
    game.targetLocation = null;
    game.huntStartTime = null;
    roundAwarded = false;
    
    const w = checkWinner();
    game.winner = w;
    encodeStateToURL(game);
    
    if (w) {
      renderWin();
    } else {
      renderCapture(); // Next player takes a photo
    }
  }

  function renderWin() {
    updateScoreBar();
    setScreen('win');
    stopCamera();
    stopLocationWatch();
    screens.win.innerHTML = '';
    const c = document.createElement('div');
    c.className = 'center card';
    const who = game.winner === 'A' ? game.playerAName : game.playerBName;
    const msg = document.createElement('h2');
    msg.textContent = `${who} vann!`;
    const again = document.createElement('button');
    again.className = 'primary';
    again.textContent = 'Spela igen';
    again.onclick = () => {
      const pa = game.playerAName || 'Spelare A';
      const pb = game.playerBName || 'Spelare B';
      game = { ...DEFAULT_GAME, playerAName: pa, playerBName: pb };
      encodeStateToURL(game);
      renderHome();
    };
    c.appendChild(msg);
    c.appendChild(again);
    screens.win.appendChild(c);
  }

  function renderCancel() {
    updateScoreBar();
    setScreen('cancel');
    stopCamera();
    stopLocationWatch();
    screens.cancel.innerHTML = '';
    const c = document.createElement('div');
    c.className = 'center card';
    const msg = document.createElement('h2');
    const who = game.canceledBy || 'Spelare A';
    msg.textContent = `${who} avbröt spelet`;
    const info = document.createElement('div');
    info.className = 'notice';
    info.textContent = 'Spelet är avslutat. Starta ett nytt spel från startsidan.';
    const home = document.createElement('button');
    home.className = 'primary';
    home.textContent = 'Till startsidan';
    home.onclick = () => {
      const pa = game.playerAName || 'Spelare A';
      const pb = game.playerBName || 'Spelare B';
      game = { ...DEFAULT_GAME, playerAName: pa, playerBName: pb };
      encodeStateToURL(game);
      renderHome();
    };
    c.appendChild(msg);
    c.appendChild(info);
    c.appendChild(home);
    screens.cancel.appendChild(c);
  }

  function route() {
    game = decodeStateFromURL();
    updateScoreBar();
    if (game.canceledBy) {
      renderCancel();
      return;
    }
    if (!game.isActive) {
      renderHome();
      return;
    }
    if (game.winner) {
      renderWin();
      return;
    }
    if (game.targetObjects.length > 0) {
      renderHunt();
      return;
    }
    renderCapture();
  }

  window.addEventListener('popstate', route);
  window.addEventListener('load', () => {
    route();
  });
})();