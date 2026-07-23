// @ts-nocheck
// Webview client for the LaTeX Citations view. Renders the model pushed from the
// extension and posts UI-state changes and navigation requests back. All search /
// filter / sort *decisions* are made in the extension (viewModel.ts); this file
// only reflects them and draws the list.
(function () {
	'use strict';
	const vscode = acquireVsCodeApi();

	// ---- Local UI state ---------------------------------------------------

	let state = {
		query: '',
		matchCase: false,
		matchWholeWord: false,
		useRegex: false,
		filter: 'all',
		sort: 'count-desc',
	};
	let model = null;
	let showOverview = true;
	// Expansion survives re-renders (typing, live index updates) within a session.
	const expanded = new Set();

	// ---- Small inline icon set (no icon-font dependency) ------------------

	const svg = (d, cls) =>
		`<span class="${cls || ''}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg></span>`;
	const ICON = {
		chevron: 'M6 4l4 4-4 4V4z',
		references: 'M2 3h9v2H2V3zm0 4h9v2H2V7zm0 4h6v2H2v-2zm11-6l3 3-3 3V5z',
		warning: 'M8 2l6 11H2L8 2zm-1 4v3h2V6H7zm0 4v2h2v-2H7z',
		error: 'M8 1a7 7 0 100 14A7 7 0 008 1zm3 9.5L9.5 12 8 10.5 6.5 12 5 10.5 6.5 9 5 7.5 6.5 6 8 7.5 9.5 6 11 7.5 9.5 9 11 10.5z',
		question: 'M8 1a7 7 0 100 14A7 7 0 008 1zm.9 10.9H7.1v-1.8h1.8v1.8zm.1-3.2c-.5.4-.6.6-.6 1.1H7c0-.9.3-1.4.9-1.9.5-.4.7-.6.7-1 0-.5-.4-.8-1-.8s-1 .3-1.1 1L5 6c.2-1.2 1.2-2 2.6-2 1.5 0 2.5.8 2.5 2 0 .8-.4 1.3-1.1 1.7z',
		file: 'M4 1h6l3 3v11H4V1zm5 1v3h3L9 2z',
		copy: 'M4 2h6v2h2v10H6v-2H4V2zm1 1v8h1V4h5V3H5zm2 3h4v7H7V6z',
		book: 'M3 2h9a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1zm1 2v8h7V4H4z',
		graph: 'M2 2h1v11h11v1H2V2zm3 7h1v3H5V9zm3-3h1v6H8V6zm3 1h1v5h-1V7z',
		check: 'M6.5 11.5L3 8l1-1 2.5 2.5L12 4l1 1-6.5 6.5z',
	};

	// ---- DOM refs ---------------------------------------------------------

	const $ = (id) => document.getElementById(id);
	const searchInput = $('search');
	const searchBox = $('searchBox');
	const content = $('content');
	const resultInfo = $('resultInfo');
	const tg = { case: $('tgCase'), word: $('tgWord'), regex: $('tgRegex') };
	const filterBtn = $('btnFilter');
	const sortBtn = $('btnSort');
	const filterMenu = $('filterMenu');
	const sortMenu = $('sortMenu');

	// Filter/sort options are supplied by the extension (model/viewOptions) in each
	// update message, so labels and ids live in exactly one place.
	let options = { filters: [], sorts: [] };

	/** Turn grouped options into menu items, inserting a separator between groups. */
	function toMenuItems(opts) {
		const items = [];
		let prevGroup;
		for (const opt of opts) {
			if (prevGroup !== undefined && opt.group !== prevGroup) {
				items.push({ sep: true });
			}
			items.push({ id: opt.id, label: opt.label });
			prevGroup = opt.group;
		}
		return items;
	}

	// ---- Helpers ----------------------------------------------------------

	function escapeHtml(text) {
		return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	}

	function escapeRegExp(text) {
		return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	/** Build the same matcher the extension uses, for presentational highlighting. */
	function highlightRegex() {
		if (!state.query) {
			return null;
		}
		let body;
		if (state.useRegex) {
			body = state.query;
		} else {
			body = escapeRegExp(state.query);
		}
		if (state.matchWholeWord) {
			body = `\\b(?:${body})\\b`;
		}
		try {
			return new RegExp(body, state.matchCase ? 'gu' : 'giu');
		} catch {
			return null;
		}
	}

	/** Escape `text`, wrapping query matches in a highlight span. */
	function highlight(text, re) {
		if (!re) {
			return escapeHtml(text);
		}
		re.lastIndex = 0;
		let out = '';
		let last = 0;
		let m;
		// Guard against zero-width matches looping forever.
		let guard = 0;
		while ((m = re.exec(text)) !== null && guard++ < 10000) {
			if (m.index >= last) {
				out += escapeHtml(text.slice(last, m.index));
				out += `<span class="match">${escapeHtml(m[0])}</span>`;
				last = m.index + m[0].length;
			}
			if (m[0].length === 0) {
				re.lastIndex++;
			}
		}
		out += escapeHtml(text.slice(last));
		return out;
	}

	function rowIcon(name, extraClass) {
		return `<span class="row-icon ${extraClass || ''}">${svg(ICON[name])}</span>`;
	}

	function twisty(isExpandable) {
		return `<span class="twisty ${isExpandable ? '' : 'spacer'}">${isExpandable ? svg(ICON.chevron) : ''}</span>`;
	}

	// ---- Rendering --------------------------------------------------------

	function render() {
		syncToolbar();
		if (!model) {
			content.innerHTML = '';
			return;
		}
		if (!model.hasBibliography) {
			content.innerHTML =
				'<div class="empty">No BibTeX entries found yet.<br />Open a workspace containing <code>.bib</code> and <code>.tex</code> files to see your citation usage here.</div>';
			return;
		}

		const re = highlightRegex();
		const html = [];

		// Overview — hidden while a search / filter is narrowing the list.
		if (showOverview && !model.filtering) {
			html.push(renderOverview());
		}

		for (const entry of model.entries) {
			html.push(renderEntry(entry, re));
		}

		if (model.undefinedKeys.length > 0) {
			html.push(renderUndefinedSection(re));
		}

		if (model.entries.length === 0 && model.undefinedKeys.length === 0) {
			html.push(`<div class="empty">No citations match the current search and filter.</div>`);
		}

		content.innerHTML = html.join('');
	}

	function renderOverview() {
		const s = model.stats;
		const id = 'overview';
		const isOpen = expanded.has(id);
		let html = `<div class="row group-header ${isOpen ? 'expanded' : ''}" data-kind="overview">
			${twisty(true)}${rowIcon('graph')}<span class="label">Overview</span>
			<span class="description">${s.totalSources} sources · ${s.totalCitations} citations</span></div>`;
		if (isOpen) {
			const lines = [
				['Total sources', s.totalSources, 'references'],
				['Used', s.usedSources, 'references'],
				['Unused', s.unusedSources, 'warning'],
				['Total citations', s.totalCitations, 'references'],
			];
			for (const [label, value, icon] of lines) {
				html += `<div class="row indent-1">${twisty(false)}${rowIcon(icon)}<span class="label">${label}</span><span class="spacer-flex"></span><span class="count-badge">${value}</span></div>`;
			}
		}
		return html;
	}

	function renderEntry(entry, re) {
		const id = 'entry:' + entry.key;
		const isOpen = entry.used && expanded.has(id);
		const desc = entry.used
			? entry.title
				? '· ' + escapeHtml(entry.title)
				: ''
			: 'unused' + (entry.title ? ' · ' + escapeHtml(entry.title) : '');
		const iconName = entry.used ? 'references' : 'warning';
		const iconClass = entry.used ? '' : 'warning';
		const badge = entry.used ? `<span class="count-badge">${entry.count}×</span>` : '';

		let html = `<div class="row ${isOpen ? 'expanded' : ''}" data-kind="entry" data-key="${escapeHtml(entry.key)}" data-used="${entry.used ? '1' : '0'}" title="${escapeHtml(entryTooltip(entry))}">
			${twisty(entry.used)}${rowIcon(iconName, iconClass)}
			<span class="label">${highlight(entry.key, re)}</span>
			${badge}
			<span class="description">${desc}</span>
			<span class="spacer-flex"></span>
			<span class="actions">
				<button class="action" data-action="def" data-key="${escapeHtml(entry.key)}" title="Go to Bib Definition">${svg(ICON.book)}</button>
				<button class="action" data-action="copy" data-key="${escapeHtml(entry.key)}" title="Copy Citation Key">${svg(ICON.copy)}</button>
			</span></div>`;

		if (isOpen) {
			html += renderOccurrences(entry.occurrences, re, 'entry', entry.key, 'indent-1');
		}
		return html;
	}

	function entryTooltip(entry) {
		const parts = [entry.key];
		if (entry.author) {
			parts.push(entry.author);
		}
		if (entry.year !== undefined && entry.year !== null) {
			parts.push(String(entry.year));
		}
		parts.push(entry.used ? entry.count + ' citation' + (entry.count === 1 ? '' : 's') : 'Unused');
		return parts.join(' · ');
	}

	function renderUndefinedSection(re) {
		const id = 'undefinedRoot';
		const isOpen = expanded.has(id);
		const count = model.undefinedKeys.length;
		let html = `<div class="row group-header ${isOpen ? 'expanded' : ''}" data-kind="undefinedRoot">
			${twisty(true)}${rowIcon('error', 'error')}<span class="label">Undefined citations</span>
			<span class="description">${count} key${count === 1 ? '' : 's'} not in any .bib</span></div>`;
		if (isOpen) {
			for (const u of model.undefinedKeys) {
				const kid = 'undef:' + u.key;
				const kOpen = expanded.has(kid);
				html += `<div class="row indent-1 ${kOpen ? 'expanded' : ''}" data-kind="undef" data-key="${escapeHtml(u.key)}">
					${twisty(true)}${rowIcon('question')}<span class="label">${highlight(u.key, re)}</span>
					<span class="count-badge">${u.count}×</span>
					<span class="description">missing entry</span>
					<span class="spacer-flex"></span>
					<span class="actions"><button class="action" data-action="copy" data-key="${escapeHtml(u.key)}" title="Copy Citation Key">${svg(ICON.copy)}</button></span></div>`;
				if (kOpen) {
					html += renderOccurrences(u.occurrences, re, 'undef', u.key, 'indent-2');
				}
			}
		}
		return html;
	}

	function renderOccurrences(occurrences, re, scope, key, indentClass) {
		let html = '';
		occurrences.forEach((occ, idx) => {
			html += `<div class="row ${indentClass}" data-kind="occ" data-scope="${scope}" data-key="${escapeHtml(key)}" data-idx="${idx}" title="\\${escapeHtml(occ.command)} in ${escapeHtml(occ.relPath)} (line ${occ.displayLine})">
				${twisty(false)}${rowIcon('file')}
				<span class="label">${escapeHtml(occ.relPath)}:${occ.displayLine}</span>
				<span class="description">${escapeHtml(occ.lineText)}</span></div>`;
		});
		return html;
	}

	// ---- Toolbar sync -----------------------------------------------------

	function syncToolbar() {
		if (document.activeElement !== searchInput) {
			searchInput.value = state.query;
		}
		tg.case.setAttribute('aria-pressed', String(state.matchCase));
		tg.word.setAttribute('aria-pressed', String(state.matchWholeWord));
		tg.regex.setAttribute('aria-pressed', String(state.useRegex));
		filterBtn.classList.toggle('modified', state.filter !== 'all');
		sortBtn.classList.toggle('modified', state.sort !== 'count-desc');

		const regexError = model && model.regexError;
		searchBox.classList.toggle('invalid', Boolean(regexError));

		if (regexError) {
			resultInfo.hidden = false;
			resultInfo.classList.add('error');
			resultInfo.textContent = 'Invalid regular expression';
		} else if (model && model.filtering) {
			resultInfo.hidden = false;
			resultInfo.classList.remove('error');
			const undef = model.undefinedKeys.length;
			resultInfo.textContent =
				`${model.visibleSources} of ${model.totalSources} sources` + (undef > 0 ? ` · ${undef} undefined` : '');
		} else {
			resultInfo.hidden = true;
			resultInfo.classList.remove('error');
		}
	}

	// ---- State plumbing ---------------------------------------------------

	function pushState() {
		vscode.postMessage({ type: 'state', state });
	}

	let debounceTimer;
	function onSearchInput() {
		state.query = searchInput.value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(pushState, 150);
	}

	function toggle(key) {
		state[key] = !state[key];
		syncToolbar();
		pushState();
	}

	// ---- Popup menus ------------------------------------------------------

	function buildMenu(menu, title, items, currentId, onPick) {
		let html = `<div class="menu-title">${title}</div>`;
		for (const item of items) {
			if (item.sep) {
				html += '<div class="menu-separator"></div>';
				continue;
			}
			const selected = item.id === currentId;
			html += `<button class="menu-item ${selected ? 'selected' : ''}" role="menuitemradio" aria-checked="${selected}" data-id="${item.id}">
				<span class="check">${svg(ICON.check)}</span><span>${item.label}</span></button>`;
		}
		menu.innerHTML = html;
		menu.querySelectorAll('.menu-item').forEach((el) => {
			el.addEventListener('click', () => {
				onPick(el.getAttribute('data-id'));
				closeMenus();
			});
		});
	}

	function openMenu(which) {
		closeMenus();
		if (which === 'filter') {
			buildMenu(filterMenu, 'Show', toMenuItems(options.filters), state.filter, (id) => {
				state.filter = id;
				syncToolbar();
				pushState();
			});
			filterMenu.hidden = false;
			filterBtn.classList.add('active');
			filterBtn.setAttribute('aria-expanded', 'true');
		} else {
			buildMenu(sortMenu, 'Sort by', toMenuItems(options.sorts), state.sort, (id) => {
				state.sort = id;
				syncToolbar();
				pushState();
			});
			sortMenu.hidden = false;
			sortBtn.classList.add('active');
			sortBtn.setAttribute('aria-expanded', 'true');
		}
	}

	function closeMenus() {
		filterMenu.hidden = true;
		sortMenu.hidden = true;
		filterBtn.classList.remove('active');
		sortBtn.classList.remove('active');
		filterBtn.setAttribute('aria-expanded', 'false');
		sortBtn.setAttribute('aria-expanded', 'false');
	}

	function toggleMenu(which, btn, menu) {
		if (!menu.hidden) {
			closeMenus();
		} else {
			openMenu(which);
		}
	}

	// ---- Interaction ------------------------------------------------------

	function toggleExpand(id) {
		if (expanded.has(id)) {
			expanded.delete(id);
		} else {
			expanded.add(id);
		}
		render();
	}

	function onContentClick(event) {
		const actionEl = event.target.closest('[data-action]');
		if (actionEl) {
			event.stopPropagation();
			const key = actionEl.getAttribute('data-key');
			if (actionEl.getAttribute('data-action') === 'copy') {
				vscode.postMessage({ type: 'copyKey', key });
			} else {
				vscode.postMessage({ type: 'goToBibDefinition', key });
			}
			return;
		}

		const row = event.target.closest('[data-kind]');
		if (!row) {
			return;
		}
		const kind = row.getAttribute('data-kind');
		const key = row.getAttribute('data-key');

		if (kind === 'overview') {
			toggleExpand('overview');
		} else if (kind === 'undefinedRoot') {
			toggleExpand('undefinedRoot');
		} else if (kind === 'undef') {
			toggleExpand('undef:' + key);
		} else if (kind === 'entry') {
			if (row.getAttribute('data-used') === '1') {
				toggleExpand('entry:' + key);
			} else {
				// Unused entries have no occurrences; jump to the .bib definition.
				vscode.postMessage({ type: 'goToBibDefinition', key });
			}
		} else if (kind === 'occ') {
			const scope = row.getAttribute('data-scope');
			const idx = Number(row.getAttribute('data-idx'));
			const list = scope === 'undef' ? model.undefinedKeys : model.entries;
			const container = list.find((x) => x.key === key);
			const occ = container && container.occurrences[idx];
			if (occ) {
				vscode.postMessage({ type: 'goToUsage', citation: stripWire(occ) });
			}
		}
	}

	/** Send back only the raw Citation fields the extension needs to navigate. */
	function stripWire(occ) {
		return {
			key: occ.key,
			command: occ.command,
			filePath: occ.filePath,
			line: occ.line,
			character: occ.character,
			endCharacter: occ.endCharacter,
			lineText: occ.lineText,
		};
	}

	// ---- Wiring -----------------------------------------------------------

	searchInput.addEventListener('input', onSearchInput);
	searchInput.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && searchInput.value) {
			searchInput.value = '';
			onSearchInput();
			e.stopPropagation();
		}
	});
	tg.case.addEventListener('click', () => toggle('matchCase'));
	tg.word.addEventListener('click', () => toggle('matchWholeWord'));
	tg.regex.addEventListener('click', () => toggle('useRegex'));
	filterBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		toggleMenu('filter', filterBtn, filterMenu);
	});
	sortBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		toggleMenu('sort', sortBtn, sortMenu);
	});
	content.addEventListener('click', onContentClick);
	document.addEventListener('click', (e) => {
		if (!e.target.closest('.menu-anchor')) {
			closeMenus();
		}
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			closeMenus();
		}
	});

	window.addEventListener('message', (event) => {
		const msg = event.data;
		if (msg && msg.type === 'update') {
			model = msg.model;
			state = msg.state;
			showOverview = msg.showOverview;
			if (msg.options) {
				options = msg.options;
			}
			render();
		}
	});

	// Tell the extension we're ready to receive the first model.
	vscode.postMessage({ type: 'ready' });
})();
