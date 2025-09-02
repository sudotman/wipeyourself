(function(){
	const API = {
		list: (limit=60) => fetch(`/api/images?limit=${limit}`).then(r=>r.json())
	};

	const stage = document.getElementById('stage');
	const canvas = document.getElementById('canvas');
	const loading = document.getElementById('loading');
	const recenterBtn = document.getElementById('recenter');

	// Config
	const GRID_SIZE = 360;
	const MAX_PER_CELL = 6;
	const MAX_PER_BATCH = 28;
	const LONG_PRESS_MS = 280;
	const FRICTION = 0.90; // inertia decay per frame
	const LERP = 0.14; // pan smoothing factor

	const used = new Set();
	const occupancy = new Map(); // key: "ix,iy" -> count
	let loadingBatch = false;

	// World state
	let worldWidth = canvas.clientWidth;
	let worldHeight = canvas.clientHeight;
	let targetX = 0, targetY = 0; // desired pan
	let viewX = 0, viewY = 0; // rendered pan
	let inertiaVX = 0, inertiaVY = 0; // inertial velocity
	let lastPanAt = performance.now();

	// Drag state (pan)
	let isPanning = false;
	let dragStartX = 0, dragStartY = 0;
	let startTargetX = 0, startTargetY = 0;

	// Drag state (image)
	let imageDrag = null; // {el, startWX, startWY, offsetX, offsetY}
	let longPressTimer = 0;

	// Lazy load IO
	const io = new IntersectionObserver((entries)=>{
		for(const entry of entries){
			if(entry.isIntersecting){
				const img = entry.target.querySelector('img.art-img');
				if(img && img.dataset.src && !img.src){ img.src = img.dataset.src; }
			}
		}
	},{ root: null, rootMargin: '800px' });

	function rand(min, max){ return Math.random() * (max - min) + min; }
	function keyFor(wx, wy){ return `${Math.floor(wx/GRID_SIZE)},${Math.floor(wy/GRID_SIZE)}`; }
	function occGet(wx, wy){ return occupancy.get(keyFor(wx,wy)) || 0; }
	function occInc(wx, wy){ const k = keyFor(wx,wy); occupancy.set(k, (occupancy.get(k)||0)+1); }
	function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

	function applyPan(){
		canvas.style.transform = `translate(calc(-50% + ${viewX}px), calc(-50% + ${viewY}px))`;
	}

	function animate(){
		// Apply inertia to target
		if(!isPanning && !imageDrag){
			targetX += inertiaVX;
			targetY += inertiaVY;
			inertiaVX *= FRICTION;
			inertiaVY *= FRICTION;
			if(Math.abs(inertiaVX) < 0.01) inertiaVX = 0;
			if(Math.abs(inertiaVY) < 0.01) inertiaVY = 0;
		}
		// Lerp rendered pan to target
		viewX += (targetX - viewX) * LERP;
		viewY += (targetY - viewY) * LERP;
		applyPan();
		requestAnimationFrame(animate);
	}

	function recenter(){ targetX = 0; targetY = 0; inertiaVX = 0; inertiaVY = 0; }

	function createArt(url){
		const container = document.createElement('div');
		container.className = 'art';
		const img = document.createElement('img');
		img.className = 'art-img';
		img.loading = 'lazy';
		img.alt = 'inspiration';
		img.decoding = 'async';
		img.dataset.src = url;
		const dl = document.createElement('a');
		dl.className = 'dl';
		dl.textContent = 'download';
		dl.href = appendParam(url, 'download', '1');
		dl.setAttribute('download', '');
		container.appendChild(img);
		container.appendChild(dl);
		return container;
	}

	function appendParam(url, key, val){
		const u = new URL(url, window.location.origin);
		u.searchParams.set(key, val);
		return u.pathname + u.search;
	}

	function placeImage(url){
		if(used.has(url)) return;
		// Try to find a spot that is not overcrowded
		let attempts = 6;
		let wx = 0, wy = 0;
		while(attempts--){
			// Bias placement around current view center but allow full world
			const bias = 0.5; // 0=center bias, 1=uniform
			const cx = -targetX, cy = -targetY;
			wx = rand(-0.5*worldWidth, 0.5*worldWidth) * bias + cx*(1-bias) + rand(-600,600);
			wy = rand(-0.5*worldHeight,0.5*worldHeight) * bias + cy*(1-bias) + rand(-600,600);
			if(occGet(wx, wy) < MAX_PER_CELL) break;
		}
		if(occGet(wx, wy) >= MAX_PER_CELL) return; // skip overly dense

		used.add(url);
		occInc(wx, wy);

		const art = createArt(url);
		art.dataset.wx = String(wx);
		art.dataset.wy = String(wy);
		art.style.left = `calc(50% + ${wx}px)`;
		art.style.top = `calc(50% + ${wy}px)`;

		canvas.appendChild(art);
		io.observe(art);
	}

	async function loadMore(){
		if(loadingBatch) return;
		loadingBatch = true;
		loading.style.display = 'block';
		try{
			const res = await API.list(72);
			const urls = res.images || [];
			if(urls.length){
				// Expand world slightly
				worldWidth *= 1.06;
				worldHeight *= 1.06;
				canvas.style.width = `${worldWidth}px`;
				canvas.style.height = `${worldHeight}px`;
				let placed = 0;
				for(const u of urls){
					placeImage(u);
					if(++placed >= MAX_PER_BATCH) break;
				}
			}
		} finally {
			loadingBatch = false;
			loading.style.display = 'none';
		}
	}

	function onWheel(e){
		const factor = 0.9;
		inertiaVX -= (e.shiftKey ? e.deltaY : e.deltaX) * factor * 0.02;
		inertiaVY -= e.deltaY * factor * 0.02;
		lastPanAt = performance.now();
	}

	function startPan(e){
		isPanning = true;
		document.body.classList.add('panning');
		dragStartX = e.clientX; dragStartY = e.clientY;
		startTargetX = targetX; startTargetY = targetY;
		inertiaVX = 0; inertiaVY = 0;
		stage.setPointerCapture(e.pointerId);
	}
	function movePan(e){
		if(!isPanning || imageDrag) return;
		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;
		const now = performance.now();
		// update target directly; animate loop will smooth
		targetX = startTargetX + dx;
		targetY = startTargetY + dy;
		// approximate velocity for inertia
		inertiaVX = (dx) * 0.08;
		inertiaVY = (dy) * 0.08;
		lastPanAt = now;
	}
	function endPan(e){
		isPanning = false;
		document.body.classList.remove('panning');
		stage.releasePointerCapture(e.pointerId);
	}

	function onPointerDown(e){
		// Long-press detection for image drag
		const target = e.target;
		if(target && target.closest && target.closest('.art')){
			const art = target.closest('.art');
			clearTimeout(longPressTimer);
			longPressTimer = setTimeout(()=>{
				beginImageDrag(e, art);
			}, LONG_PRESS_MS);
		}
		startPan(e);
	}
	function onPointerMove(e){
		// if pointer moved significantly, cancel pending long-press
		if(Math.abs(e.clientX - dragStartX) > 6 || Math.abs(e.clientY - dragStartY) > 6){
			clearTimeout(longPressTimer);
		}
		if(imageDrag){
			updateImageDrag(e);
			return;
		}
		movePan(e);
	}
	function onPointerUp(e){
		clearTimeout(longPressTimer);
		if(imageDrag){
			endImageDrag(e);
			return;
		}
		endPan(e);
	}

	function beginImageDrag(e, art){
		imageDrag = {
			el: art,
			startWX: parseFloat(art.dataset.wx || '0'),
			startWY: parseFloat(art.dataset.wy || '0'),
			offsetX: 0,
			offsetY: 0
		};
		// Compute pointer offset relative to art
		const rect = art.getBoundingClientRect();
		imageDrag.offsetX = (e.clientX - rect.left) - rect.width/2;
		imageDrag.offsetY = (e.clientY - rect.top) - rect.height/2;
		art.style.zIndex = '5';
	}
	function updateImageDrag(e){
		const art = imageDrag.el;
		// Convert pointer movement to world delta: since canvas is panned by viewX/viewY, world center under pointer shifts accordingly
		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;
		const wx = imageDrag.startWX + dx;
		const wy = imageDrag.startWY + dy;
		art.dataset.wx = String(wx);
		art.dataset.wy = String(wy);
		art.style.left = `calc(50% + ${wx}px)`;
		art.style.top = `calc(50% + ${wy}px)`;
	}
	function endImageDrag(e){
		const art = imageDrag.el;
		art.style.zIndex = '';
		imageDrag = null;
	}

	recenterBtn.addEventListener('click', recenter);
	stage.addEventListener('wheel', onWheel, { passive: true });
	stage.addEventListener('pointerdown', onPointerDown);
	stage.addEventListener('pointermove', onPointerMove);
	stage.addEventListener('pointerup', onPointerUp);
	stage.addEventListener('pointercancel', onPointerUp);

	// Initial sizes and position
	canvas.style.width = `${worldWidth}px`;
	canvas.style.height = `${worldHeight}px`;
	applyPan();
	requestAnimationFrame(animate);

	// Kickoff
	loadMore();
	setInterval(()=>{ if(!loadingBatch) loadMore(); }, 9000);
})();
