class CardForge {

    constructor() {
        this.canvas = document.getElementById('mainCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.interactionLayer = document.getElementById('interactionLayer');
        this.previewCanvas = document.getElementById('previewCanvas');
        this.previewCtx = this.previewCanvas.getContext('2d');

        this.mode = 'template';
        this.currentTemplateName = '默认模板';
        this.currentCardName = '';
        this.currentDeck = '默认卡组';
        this.currentViewDeck = 'ALL';
        this.width = 400;
        this.height = 600;
        this.scaleFactor = 4; // HD
        this.viewZoom = 1.0;
        this.isCardEditing = false;
        this.isResizing = false;
        this.returnToDeckMode = false;
        this.isDeckDirty = true;
        this.draggedCardName = null;
        this.draggedCardName = null;
        this.isAutoExporting = false;
        this.autoExportQueue = [];
        this.autoExportDelay = 700; // 每张卡之间的等待时间（毫秒）


        this.template = [];
        this.selectedId = null;
        this.cardData = {};

        // 初始化为空，等待 load
        this.templateLibrary = {};
        this.cardLibrary = {};
        this.decks = [];
        this.isPanelResizing = false;
        this.isPropResizing = false;

        // --- 步骤2修改：实例化适配器并启动 ---
        this.storage = new StorageAdapter();
        this.initApp();
    }

    async initApp() {
        await this.storage.init();
        const config = this.storage.loadConfig() || {};

        // ==========================================
        // ★ 新增：仓库管理初始化
        // ==========================================
        this.workspaces = config.workspaces || [{ id: 'default', name: '默认本地缓存', path: '' }];
        this.currentWorkspace = config.currentWorkspace || 'default';

        // 如果找不到当前配置的仓库，回退到默认
        if (!this.workspaces.find(w => w.id === this.currentWorkspace)) {
            this.currentWorkspace = 'default';
        }

        // 把当前仓库路径传递给底层存储适配器
        this.applyWorkspaceToStorage();
        this.updateWorkspaceUI();
        // ==========================================

        // 此时 load 出来的数据，已经是该仓库下的独有数据了
        this.templateLibrary = this.storage.load('cardForge_templates') || {};
        this.cardLibrary = this.storage.load('cardForge_cards') || {};
        this.decks = this.extractDecks();
        this.normalizeAllDeckOrders();

        this.resizeCanvas();

        // 保留左右分栏的拖拽
        this.setupPanelResizer();

        // 这样程序才能顺利执行到这里，绑定所有的点击事件
        this.setupEvents();
        this.render();

        this.updateDeckUI();
        this.updateCardSelectorUI();
        this.updateDesignerTemplateSelectorUI();
        this.updateTemplateSettingsUI();
        this.bindSettings();
        this.updateUI();

        console.log(`[Workspace] 已加载仓库: ${this.currentWorkspace}`);
    }

    // --- ★ 仓库 (Workspace) 管理功能 ★ ---

    updateWorkspaceUI() {
        const selector = document.getElementById('workspaceSelector');
        if (!selector) return;
        selector.innerHTML = '';
        this.workspaces.forEach(ws => {
            const opt = document.createElement('option');
            opt.value = ws.id;
            opt.innerText = ws.name;
            if (ws.id === this.currentWorkspace) opt.selected = true;
            selector.appendChild(opt);
        });
    }

    applyWorkspaceToStorage() {
        const ws = this.workspaces.find(w => w.id === this.currentWorkspace);
        if (ws) {
            // 通知 StorageAdapter 切换根目录
            if (typeof this.storage.setRootPath === 'function') {
                this.storage.setRootPath(ws.path);
            }
            // ★ 核心修复：读取当前仓库专属的 Obsidian 路径，没有则置空，绝不覆盖
            this.obsidianPath = ws.obsidianPath || null;
        }
    }

    async bindNewWorkspace() {
        const chooser = document.createElement('input');
        chooser.type = 'file';
        chooser.setAttribute('nwdirectory', ''); // 唤起文件夹选择

        chooser.onchange = (e) => {
            const path = e.target.files[0].path;
            let name = prompt(`已选择目录：\n${path}\n\n请为新仓库/游戏项目命名:`, "新游戏项目");
            if (!name) return; // 取消操作

            const newId = 'ws_' + Date.now();
            this.workspaces.push({ id: newId, name: name, path: path });

            // 保存全局配置并立即切换
            this.switchWorkspace(newId);
        };
        chooser.click();
    }

    async switchWorkspace(wsId) {
        if (this.currentWorkspace === wsId) return;

        if (this.isCardEditing || this.template.length > 0) {
            if (!confirm("切换仓库会丢失当前未保存的画布修改，确定继续吗？")) {
                this.updateWorkspaceUI(); // 恢复下拉菜单选择
                return;
            }
        }

        this.currentWorkspace = wsId;

        // 1. 保存全局配置 (记录你的仓库列表和最后打开的仓库)
        this.storage.saveConfig({
            workspaces: this.workspaces,
            currentWorkspace: this.currentWorkspace
        });

        // 2. 切换底层存储路径
        this.applyWorkspaceToStorage();

        // 3. 彻底清空当前内存中的视图状态
        this.template = [];
        this.cardData = {};
        this.selectedId = null;
        this.currentTemplateName = "未命名模板";
        this.currentCardName = "";
        this.currentDeck = "默认卡组";
        this.isCardEditing = false;
        this.draggedCardName = null;

        // 4. 重新读取新仓库的 JSON 库
        this.templateLibrary = this.storage.load('cardForge_templates') || {};
        this.cardLibrary = this.storage.load('cardForge_cards') || {};
        this.decks = this.extractDecks();

        // 5. 强制全量刷新 UI
        this.updateWorkspaceUI();
        this.updateDesignerTemplateSelectorUI();
        this.updateCardSelectorUI();
        this.updateDeckUI();
        this.isDeckDirty = true;
        this.updateDeckGalleryUI();
        this.updateLayerList();
        this.updatePropEditor();
        this.updateCardInputs();

        document.getElementById('tplNameInput').value = "";
        document.getElementById('cardNameInput').value = "";
        document.getElementById('cardDeckInput').value = "";

        this.resizeCanvas();
        this.render();

        const wsName = this.workspaces.find(w => w.id === wsId)?.name || wsId;
        alert(`已切换到仓库: [${wsName}]\n所有模板、卡牌和图片资源已隔离。`);
    }

    extractDecks() {

        const decks = new Set(['默认卡组']);

        Object.values(this.cardLibrary).forEach(card => {

            if (card.deck) decks.add(card.deck);

        });

        return Array.from(decks).sort();

    }

    getDeckCards(deckName) {
        if (!deckName) return [];
        return Object.values(this.cardLibrary).filter(card => card.deck === deckName);
    }

    compareCardOrder(a, b) {
        const ao = (typeof a.order === 'number') ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = (typeof b.order === 'number') ? b.order : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return (a.name || '').localeCompare(b.name || '');
    }

    getNextCardOrder(deckName) {
        const cards = this.getDeckCards(deckName);
        if (cards.length === 0) return 1;
        const maxOrder = Math.max(...cards.map(c => (typeof c.order === 'number') ? c.order : 0));
        return maxOrder + 1;
    }

    normalizeDeckOrder(deckName) {
        if (!deckName) return false;
        const cards = this.getDeckCards(deckName);
        if (!cards.length) return false;
        cards.sort((a, b) => this.compareCardOrder(a, b));
        let changed = false;
        cards.forEach((card, idx) => {
            const desired = idx + 1;
            if (card.order !== desired) {
                this.cardLibrary[card.name].order = desired;
                changed = true;
            }
        });
        return changed;
    }

    normalizeAllDeckOrders() {
        let changed = false;
        this.decks.forEach(deck => { if (this.normalizeDeckOrder(deck)) changed = true; });
        if (changed) this.saveStorage('cardForge_cards', this.cardLibrary);
    }

    async ensureCardAssetsReady() {
        await this.preloadTemplateStaticImages();
        const tasks = [];
        Object.values(this.cardData).forEach(slot => {
            const src = slot?.imagePath || slot?._imgSrc;
            if (src && !slot.img) {
                tasks.push(new Promise(resolve => {
                    const img = new Image();
                    img.onload = () => { slot.img = img; resolve(); };
                    img.onerror = resolve;
                    img.src = this.storage.getImgSource(src);
                }));
            }
        });
        await Promise.all(tasks);
    }


    async preloadTemplateStaticImages(template = this.template) {
        const tasks = template.map(el => {
            if (el.type !== 'static-image') return Promise.resolve();
            const src = el.imagePath || el._srcData;
            if (!src) return Promise.resolve();
            return new Promise(resolve => {
                if (el.src && el.src.complete) { resolve(); return; }
                const img = new Image();
                img.onload = () => { el.src = img; resolve(); };
                img.onerror = resolve;
                img.src = this.storage.getImgSource(src);
            });
        });
        await Promise.all(tasks);
    }



    sanitizeFileName(name, fallbackPrefix = 'card') {
        const base = (name && name.trim()) ? name.trim() : `${fallbackPrefix}_${Date.now()}`;
        return base.replace(/[\\\/:*?"<>|]/g, '_');
    }

    bindSettings() {

        const nameInput = document.getElementById('tplNameInput');

        const wInput = document.getElementById('tplWidthInput');

        const hInput = document.getElementById('tplHeightInput');



        nameInput.value = this.currentTemplateName;

        wInput.value = this.width;

        hInput.value = this.height;



        nameInput.oninput = (e) => this.currentTemplateName = e.target.value;

        wInput.onchange = (e) => {

            this.width = parseInt(e.target.value) || 400;

            this.resizeCanvas();

        };

        hInput.onchange = (e) => {

            this.height = parseInt(e.target.value) || 600;

            this.resizeCanvas();

        };



        document.getElementById('cardNameInput').oninput = (e) => this.currentCardName = e.target.value;

        document.getElementById('cardDeckInput').onchange = (e) => this.currentDeck = e.target.value;

    }



    updateTemplateSettingsUI() {

        document.getElementById('tplNameInput').value = this.currentTemplateName;

        document.getElementById('tplWidthInput').value = this.width;

        document.getElementById('tplHeightInput').value = this.height;

    }

    // ============================================================
    // ★★★ 缺失的辅助函数 (请把这段插在 updateTemplateSettingsUI 后面) ★★★
    // ============================================================

    bindInput(id, val, setter) {
        const el = document.getElementById(id);
        if (!el) return; // 防止找不到元素报错
        el.value = val;
        el.oninput = (e) => {
            setter(e.target.value);
            this.updateLayerList();
            this.render();
        };
    }

    createInputProp(parent, label, val, setter) {
        const div = document.createElement('div');
        div.innerHTML = `<label class="block text-gray-500">${label}</label>`;
        const input = document.createElement('input');
        input.type = "text";
        input.className = "w-full p-1 rounded bg-gray-800";
        input.value = val;
        input.oninput = (e) => { setter(e.target.value); this.render(); };
        div.appendChild(input);
        parent.appendChild(div);
    }

    createNumberProp(parent, label, val, setter) {
        const div = document.createElement('div');
        div.innerHTML = `<label class="block text-gray-500">${label}</label>`;
        const input = document.createElement('input');
        input.type = "number";
        input.className = "w-full p-1 rounded bg-gray-800";
        input.value = val;
        input.oninput = (e) => { setter(e.target.value); this.render(); };
        div.appendChild(input);
        parent.appendChild(div);
    }

    createColorProp(parent, label, val, setter) {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center";
        div.innerHTML = `<label class="text-gray-500">${label}</label>`;
        const input = document.createElement('input');
        input.type = "color";
        input.className = "h-6 w-12 bg-transparent border-0";
        input.value = val;
        input.oninput = (e) => { setter(e.target.value); this.render(); };
        div.appendChild(input);
        parent.appendChild(div);
    }

    createSelectProp(parent, label, val, options, setter) {
        const div = document.createElement('div');
        div.innerHTML = `<label class="block text-gray-500">${label}</label>`;
        const select = document.createElement('select');
        select.className = "w-full p-1 rounded bg-gray-800 text-xs";
        options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.text = opt;
            o.selected = opt === val;
            select.appendChild(o);
        });
        select.onchange = (e) => { setter(e.target.value); this.render(); };
        div.appendChild(select);
        parent.appendChild(div);
    }

    createCheckboxProp(parent, label, val, setter) {
        const div = document.createElement('div');
        div.className = "flex items-center gap-2 mt-2 cursor-pointer group";

        const input = document.createElement('input');
        input.type = "checkbox";
        input.className = "w-4 h-4 rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-0 cursor-pointer";
        // 关键：正确设置勾选状态
        input.checked = !!val;

        const span = document.createElement('span');
        span.className = "text-gray-400 text-xs select-none group-hover:text-gray-200 transition-colors";
        span.innerText = label;

        // 绑定事件
        input.onchange = (e) => {
            setter(e.target.checked);
            this.render();
        };

        // 体验优化：点击文字也能切换
        span.onclick = () => {
            input.checked = !input.checked;
            setter(input.checked);
            this.render();
        };

        div.appendChild(input);
        div.appendChild(span);
        parent.appendChild(div);
    }

    createFileProp(parent, label, callback) {
        const div = document.createElement('div');
        div.innerHTML = `<label class="block text-gray-500 mb-1">${label}</label>`;
        const btn = document.createElement('button');
        btn.className = "w-full bg-gray-700 hover:bg-gray-600 text-xs py-1 rounded text-white";
        btn.innerText = "选择文件...";
        const input = document.createElement('input');
        input.type = "file";
        input.accept = "image/*";
        input.className = "hidden";
        input.onchange = (e) => { if (e.target.files[0]) callback(e.target.files[0]); };
        btn.onclick = () => input.click();
        div.appendChild(btn);
        div.appendChild(input);
        parent.appendChild(div);
    }
    // ============================================================

    // --- Zoom Functionality ---

    updateCanvasZoom() {

        const wrapper = document.getElementById('canvasWrapper');

        if (wrapper) {

            wrapper.style.transform = `scale(${this.viewZoom})`;

            document.getElementById('canvasSizeDisplay').innerText =

                `${this.width} x ${this.height} | Zoom: ${Math.round(this.viewZoom * 100)}%`;

        }

    }



    setMode(newMode) {
        const oldMode = this.mode; // 记录旧模式
        this.mode = newMode;

        // 1. 处理返回按钮的显示逻辑
        if (newMode === 'card' && this.returnToDeckMode) {
            document.getElementById('btnReturnToDeck').classList.remove('hidden');
        } else {
            document.getElementById('btnReturnToDeck').classList.add('hidden');
            if (newMode !== 'card') this.returnToDeckMode = false;
        }

        // 2. 切换左侧面板显示/隐藏
        document.getElementById('panelTemplate').classList.toggle('hidden', newMode !== 'template');
        document.getElementById('panelCard').classList.toggle('hidden', newMode !== 'card');
        document.getElementById('panelDeckView').classList.toggle('hidden', newMode !== 'deck');

        // ★ 核心修复：切换右侧面板和右侧拖拽条的显示/隐藏 ★
        const rightPanel = document.getElementById('rightPanel');
        const resizerRight = document.getElementById('uiResizerRight');
        if (rightPanel) rightPanel.classList.toggle('hidden', newMode !== 'template');
        if (resizerRight) resizerRight.classList.toggle('hidden', newMode !== 'template');

        // 3. 按钮状态切换
        document.getElementById('btnModeTemplate').classList.toggle('active', newMode === 'template');
        document.getElementById('btnModeCard').classList.toggle('active', newMode === 'card');
        document.getElementById('btnModeDeck').classList.toggle('active', newMode === 'deck');

        // 4. 画布与网格切换
        document.getElementById('canvasWrapper').classList.toggle('hidden', newMode === 'deck');
        document.getElementById('deckGridWrapper').classList.toggle('hidden', newMode !== 'deck');

        // 5. 模式切换时的自动同步逻辑
        if (newMode === 'template') {
            // 如果是从卡牌编辑模式切回来的，且当前有正在编辑的卡牌
            if (oldMode === 'card' && this.currentTemplateName) {
                // 同步下拉菜单的选择
                const selector = document.getElementById('designerTemplateSelector');
                if (selector) selector.value = this.currentTemplateName;
                // 确保模板设置 UI（名字、宽、高）与当前一致
                this.updateTemplateSettingsUI();
            }
            this.updateLayerList();
            this.updatePropEditor();
        }
        else if (newMode === 'card') {
            this.updateCardInputs();
        }
        else if (newMode === 'deck') {
            if (this.isDeckDirty) {
                this.updateDeckGalleryUI();
                this.isDeckDirty = false;
            }
        }

        // 每次切换模式后，重绘一次画布
        this.render();
    }


    switchToDeckView() { this.setMode('deck'); }



    updateDeckGalleryUI() {

        const autoExportBtn = document.getElementById('btnAutoExport');
        const deckReady = this.currentViewDeck && this.currentViewDeck !== 'ALL' && !this.isAutoExporting;

        if (autoExportBtn) {
            autoExportBtn.disabled = !deckReady;
            autoExportBtn.innerText = this.isAutoExporting ? '正在导出…' : '自动导出';
        }

        const listContainer = document.getElementById('deckListContainer');

        listContainer.innerHTML = '';



        const allDecks = ['ALL', ...this.decks];

        allDecks.forEach(deck => {

            // 容器

            const container = document.createElement('div');

            const isSelected = this.currentViewDeck === deck || (deck === 'ALL' && !this.currentViewDeck);



            container.className = `group flex items-center justify-between mb-1 pr-1 rounded transition-colors ${isSelected ? 'bg-blue-600' : 'hover:bg-gray-800'}`;



            // 1. 卡组名称按钮

            const selectBtn = document.createElement('button');

            selectBtn.className = `flex-1 text-left px-3 py-2 text-xs font-bold truncate outline-none ${isSelected ? 'text-white' : 'text-gray-400 group-hover:text-white'}`;

            selectBtn.innerHTML = `<i class="fa-solid ${deck === 'ALL' ? 'fa-layer-group' : 'fa-folder'} mr-2"></i> ${deck === 'ALL' ? '全部卡牌' : deck}`;

            selectBtn.onclick = () => {

                this.currentViewDeck = deck;

                this.isDeckDirty = true;

                this.updateDeckGalleryUI();

            };

            container.appendChild(selectBtn);



            // 2. 操作按钮组 (仅针对非 ALL 卡组)

            if (deck !== 'ALL') {

                const btnGroup = document.createElement('div');

                btnGroup.className = `flex items-center gap-1 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`;



                // 重命名按钮

                const renameBtn = document.createElement('button');

                renameBtn.className = `text-gray-500 hover:text-blue-300 px-1.5 py-1 ${isSelected ? 'text-blue-200' : ''}`;

                renameBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';

                renameBtn.title = "重命名卡组";

                renameBtn.onclick = (e) => {

                    e.stopPropagation();

                    this.renameDeck(deck);

                };



                // 删除按钮

                const delBtn = document.createElement('button');

                delBtn.className = `text-gray-500 hover:text-red-400 px-1.5 py-1 ${isSelected ? 'text-red-200' : ''}`;

                delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';

                delBtn.title = "删除卡组";

                delBtn.onclick = (e) => {

                    e.stopPropagation();

                    this.deleteDeck(deck);

                };



                btnGroup.appendChild(renameBtn);

                btnGroup.appendChild(delBtn);

                container.appendChild(btnGroup);

            }



            listContainer.appendChild(container);

        });



        // 渲染网格 (保持不变)

        const grid = document.getElementById('deckGrid');

        grid.innerHTML = '';

        const isDeckView = this.currentViewDeck !== 'ALL';
        let cards = Object.values(this.cardLibrary);
        if (isDeckView) {
            cards = cards.filter(c => c.deck === this.currentViewDeck)
                .sort((a, b) => this.compareCardOrder(a, b));
        } else {
            cards = cards.sort((a, b) => {
                const deckA = a.deck || '';
                const deckB = b.deck || '';
                if (deckA !== deckB) return deckA.localeCompare(deckB);
                return this.compareCardOrder(a, b);
            });
        }

        if (isDeckView) {
            grid.ondragover = (e) => {
                if (!this.draggedCardName) return;
                e.preventDefault();
            };
            grid.ondrop = (e) => {
                if (!this.draggedCardName) return;
                e.preventDefault();
                this.handleDeckCardReorder(this.draggedCardName, null, 'end');
                this.draggedCardName = null;
            };
        } else {
            grid.ondragover = null;
            grid.ondrop = null;
        }



        if (cards.length === 0) {

            grid.innerHTML = `<div class="col-span-full text-center text-gray-500 mt-20"><i class="fa-solid fa-box-open text-4xl mb-4"></i><p>该卡组为空</p></div>`;

            return;

        }



        cards.forEach(card => {

            const div = document.createElement('div');

            const tpl = this.templateLibrary[card.templateName];

            const aspectRatio = tpl ? `${tpl.width}/${tpl.height}` : '2/3';



            div.style.aspectRatio = aspectRatio;

            div.className = "deck-card group relative bg-gray-800 rounded-lg border-2 border-gray-700 hover:border-blue-500 cursor-pointer transition-all hover:scale-105 shadow-lg overflow-hidden";



            let bgImage = null;

            if (card.data) {

                const imgData = Object.values(card.data).find(d => d.imagePath || d._imgSrc);
                if (imgData) bgImage = this.storage.getImgSource(imgData.imagePath || imgData._imgSrc);
            }

            div.innerHTML = `

                                ${bgImage ? `<div class="absolute inset-0 bg-cover bg-center opacity-50 group-hover:opacity-100 transition-opacity" style="background-image: url('${bgImage}')"></div>` : ''}

                                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"></div>

                                <div class="absolute bottom-0 left-0 right-0 p-3">

                                    <div class="text-xs text-gray-400 mb-0.5">${card.deck}</div>

                                    <div class="font-bold text-white text-sm truncate">${card.name}</div>

                                </div>

                            `;

            div.onclick = () => {
                if (this.draggedCardName) return;
                this.returnToDeckMode = true;
                this.loadCardFromLibrary(card.name);
                this.setMode('card');
            };

            if (isDeckView) {
                div.draggable = true;
                div.addEventListener('dragstart', (e) => {
                    this.draggedCardName = card.name;
                    e.dataTransfer.effectAllowed = 'move';
                    if (e.dataTransfer.setData) {
                        e.dataTransfer.setData('text/plain', card.name);
                    }
                    div.classList.add('dragging-card');
                    document.getElementById('previewCanvas').style.display = 'none'; // 新增
                });

                div.addEventListener('dragend', () => {
                    div.classList.remove('dragging-card', 'reorder-before', 'reorder-after');
                    this.draggedCardName = null;
                });
                div.addEventListener('dragover', (e) => {
                    if (!this.draggedCardName || this.draggedCardName === card.name) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = div.getBoundingClientRect();
                    const isAfter = (e.clientY - rect.top) > rect.height / 2;
                    div.classList.toggle('reorder-before', !isAfter);
                    div.classList.toggle('reorder-after', isAfter);
                });
                div.addEventListener('dragleave', () => {
                    div.classList.remove('reorder-before', 'reorder-after');
                });
                div.addEventListener('drop', (e) => {
                    if (!this.draggedCardName || this.draggedCardName === card.name) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = div.getBoundingClientRect();
                    const isAfter = (e.clientY - rect.top) > rect.height / 2;
                    div.classList.remove('reorder-before', 'reorder-after');
                    this.handleDeckCardReorder(this.draggedCardName, card.name, isAfter ? 'after' : 'before');
                    this.draggedCardName = null;
                });
            }

            div.onmouseenter = (e) => {
                if (this.draggedCardName) return;
                this.showCardPreview(card, e);
            };

            div.onmousemove = (e) => {
                if (this.draggedCardName) return;
                this.moveCardPreview(e);
            };

            div.onmouseleave = () => {
                document.getElementById('previewCanvas').style.display = 'none';
            };


            grid.appendChild(div);

        });

    }

    exportCurrentCardImage() {
        if (!this.isCardEditing) {
            alert('请先加载一张卡牌。');
            return;
        }
        const safeName = this.sanitizeFileName(this.currentCardName, 'card');
        const link = document.createElement('a');
        link.download = `${safeName}.png`;

        const tempId = this.selectedId;
        this.selectedId = null;
        this.render();

        link.href = this.canvas.toDataURL('image/png', 1.0);
        link.click();

        this.selectedId = tempId;
        this.render();
    }

    startAutoExportSequence() {
        if (this.isAutoExporting) return;
        if (!this.currentViewDeck || this.currentViewDeck === 'ALL') {
            alert('请先在左侧选择具体卡组。');
            return;
        }
        const cards = Object.values(this.cardLibrary).filter(c => c.deck === this.currentViewDeck);
        if (!cards.length) {
            alert(`卡组「${this.currentViewDeck}」为空，无法导出。`);
            return;
        }
        this.isAutoExporting = true;
        this.autoExportQueue = cards.map(card => card.name);
        this.updateDeckGalleryUI();
        this.processNextAutoExport();
    }

    async processNextAutoExport() {
        if (!this.autoExportQueue.length) {
            this.finishAutoExportSequence();
            return;
        }
        const nextName = this.autoExportQueue.shift();
        await this.loadCardFromLibrary(nextName); // 正常加载，UI 会切到卡牌界面
        await this.ensureCardAssetsReady?.();    // 如果之前已经实现过，确保图片加载完成
        this.exportCurrentCardImage();
        setTimeout(() => this.processNextAutoExport(), this.autoExportDelay);
    }

    finishAutoExportSequence() {
        this.isAutoExporting = false;
        this.autoExportQueue = [];
        this.updateDeckGalleryUI();
        console.log('自动导出序列已结束');
    }




    handleDeckCardReorder(sourceName, targetName, position = 'before') {
        if (!sourceName || this.currentViewDeck === 'ALL') return;
        const sourceCard = this.cardLibrary[sourceName];
        if (!sourceCard) return;
        const deckName = sourceCard.deck;
        if (deckName !== this.currentViewDeck) return;

        const cards = this.getDeckCards(deckName).sort((a, b) => this.compareCardOrder(a, b));
        const fromIndex = cards.findIndex(c => c.name === sourceName);
        if (fromIndex === -1) return;

        const [moved] = cards.splice(fromIndex, 1);
        let insertIndex = cards.length;

        if (targetName) {
            const targetIndex = cards.findIndex(c => c.name === targetName);
            if (targetIndex !== -1) {
                insertIndex = targetIndex + (position === 'after' ? 1 : 0);
            }
        } else if (position === 'start') {
            insertIndex = 0;
        }

        cards.splice(insertIndex, 0, moved);
        cards.forEach((card, idx) => {
            this.cardLibrary[card.name].order = idx + 1;
        });

        this.saveStorage('cardForge_cards', this.cardLibrary);
        this.updateDeckGalleryUI();
    }



    async showCardPreview(cardObj, e) {
        if (this.draggedCardName) return;
        const cvs = this.previewCanvas;
        const ctx = this.previewCtx;
        let tpl = this.templateLibrary[cardObj.templateName];
        if (!tpl) return;

        const PREVIEW_WIDTH = 400;
        const ratio = tpl.width / tpl.height;
        const PREVIEW_HEIGHT = PREVIEW_WIDTH / ratio;
        cvs.width = PREVIEW_WIDTH; cvs.height = PREVIEW_HEIGHT;
        cvs.style.display = 'block';

        ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        const scale = PREVIEW_WIDTH / tpl.width;
        ctx.save(); ctx.scale(scale, scale);

        const elements = Array.isArray(tpl) ? tpl : tpl.elements;
        for (const el of elements) {
            // --- 静态图 ---
            const staticSrc = el.imagePath || el._srcData;
            if (el.type === 'static-image' && staticSrc) {
                await this.drawImageOnCtx(ctx, staticSrc, el.x, el.y, el.w, el.h);
            }
            // 在 showCardPreview 的 user-image 绘制部分修改
            else if (el.type === 'user-image' && cardObj.data[el.label]) {
                const d = cardObj.data[el.label];
                const userSrc = d.imagePath || d._imgSrc;
                if (userSrc) {
                    await new Promise(resolve => {
                        const img = new Image();
                        img.onload = () => {
                            ctx.save();
                            ctx.beginPath(); ctx.rect(el.x, el.y, el.w, el.h); ctx.clip();

                            // ★ 同样的“铺满”基准逻辑
                            const baseScale = Math.max(el.w / img.width, el.h / img.height);
                            const userScale = (d.scale !== undefined) ? d.scale : 1;
                            const finalScale = baseScale * userScale;

                            const centerX = el.x + el.w / 2;
                            const centerY = el.y + el.h / 2;
                            const w = img.width * finalScale;
                            const h = img.height * finalScale;
                            const x = centerX - w / 2 + (d.x || 0);
                            const y = centerY - h / 2 + (d.y || 0);

                            ctx.drawImage(img, x, y, w, h);
                            ctx.restore();
                            resolve();
                        };
                        img.src = this.storage.getImgSource(userSrc);
                    });
                }
            }
            // --- 文本 (关键修改：cardObj.data[el.label]) ---
            else if (el.type === 'text') {
                const text = cardObj.data[el.label]?.text || el.defaultText;
                // ... 绘制文本逻辑 (保持你原本的字体颜色等设置) ...
                ctx.font = `${el.fontStyle || 'normal'} ${el.fontWeight || 'normal'} ${el.fontSize}px "${el.fontFamily || 'Noto Sans SC'}"`;
                ctx.fillStyle = el.color; ctx.textAlign = el.align; ctx.textBaseline = 'top';
                let x = el.x;
                if (el.align === 'center') x += el.w / 2;
                if (el.align === 'right') x += el.w;
                if (el.multiline) {
                    this.wrapText(ctx, text, x, el.y, el.w, el.fontSize * (el.lineHeight || 1.2));
                } else {
                    ctx.fillText(text, x, el.y, el.w);
                }
            }
        }
        ctx.restore();
        this.moveCardPreview(e);
    }



    drawImageOnCtx(ctx, src, x, y, w, h) {

        return new Promise(resolve => {

            const img = new Image();

            img.onload = () => { ctx.drawImage(img, x, y, w, h); resolve(); };

            img.onerror = resolve;

            img.src = this.storage.getImgSource(src);

        });

    }



    moveCardPreview(e) {
        if (this.draggedCardName) return;

        const cvs = document.getElementById('previewCanvas');

        const offset = 20;

        let top = e.clientY + offset;

        let left = e.clientX + offset;

        if (top + cvs.height > window.innerHeight) top = e.clientY - cvs.height - offset;

        if (left + cvs.width > window.innerWidth) left = e.clientX - cvs.width - offset;

        cvs.style.top = `${top}px`; cvs.style.left = `${left}px`;

    }



    // --- Logic from here identical to previous ---



    updateDesignerTemplateSelectorUI() {

        const selector = document.getElementById('designerTemplateSelector');

        selector.innerHTML = '<option value="">-- 选择模板编辑 --</option>';

        Object.keys(this.templateLibrary).forEach(name => {

            const opt = document.createElement('option'); opt.value = name; opt.innerText = name; selector.appendChild(opt);

        });

        if (this.templateLibrary[this.currentTemplateName]) { selector.value = this.currentTemplateName; }

    }



    loadTemplateForDesigner(name) {

        if (!name || !this.templateLibrary[name]) return;

        if (this.template.length > 0 && !confirm("加载新模板将覆盖当前未保存的修改，确定吗？")) {

            this.updateDesignerTemplateSelectorUI(); return;

        }

        this.loadTemplateFromLibrary(name);

        this.selectedId = null;

        this.render();

        if (this.mode !== 'template') this.setMode('template');

    }



    initNewTemplate() {

        if (this.template.length > 0 && !confirm("确定要清空画布创建新模板吗？")) return;

        this.template = [];

        this.currentTemplateName = "未命名模板";

        this.width = 400;

        this.height = 600;

        this.resizeCanvas();

        this.updateTemplateSettingsUI();

        this.selectedId = null;

        this.render();

        document.getElementById('designerTemplateSelector').value = "";

    }



    deleteTemplateFromLibrary() {
        const selector = document.getElementById('designerTemplateSelector');
        const name = selector.value;
        if (!name) { alert("请先从下拉菜单中选择一个要删除的模板。"); return; }

        if (confirm(`确定要永久删除模板 "${name}" 吗？`)) {
            delete this.templateLibrary[name];
            this.saveStorage('cardForge_templates', this.templateLibrary);
            this.updateDesignerTemplateSelectorUI();

            // ★ 核心修复：如果删除的是当前正在编辑的模板，清空画布和 UI
            if (this.currentTemplateName === name) {
                this.template = [];            // 清空图层数据
                this.selectedId = null;         // 取消选中
                this.currentTemplateName = "未命名模板";

                this.updateTemplateSettingsUI(); // 重置名字和宽高的输入框
                this.updateLayerList();          // 清空左侧图层列表
                this.updatePropEditor();         // 隐藏属性面板
                this.render();                   // 刷出一片白茫茫的画布
            }
            alert("模板已删除。");
        }
    }



    createNewCard() {

        if (Object.keys(this.templateLibrary).length === 0) {

            alert("错误：您还没有保存任何模板！\n请先切换到【模板编辑】模式，设计并保存一个模板。");

            return;

        }

        const openModal = () => { this.updateModalList(); document.getElementById('templateModal').classList.remove('hidden'); };

        if (this.isCardEditing) {

            if (confirm("开始新卡牌将清除当前画布内容。\n确定要继续吗？")) { openModal(); }

        } else { openModal(); }

    }



    updateModalList() {

        const list = document.getElementById('modalTemplateList');

        list.innerHTML = '';

        const keys = Object.keys(this.templateLibrary);

        keys.forEach(name => {

            const btn = document.createElement('button');

            btn.className = "w-full text-left p-3 rounded bg-gray-800 hover:bg-blue-900 border border-gray-700 hover:border-blue-500 transition-colors flex justify-between items-center group";

            btn.onclick = () => this.confirmNewCard(name);

            const meta = this.templateLibrary[name];

            const sizeText = (meta.width && meta.height) ? `${meta.width}x${meta.height}` : "";

            btn.innerHTML = `<span class="font-bold text-gray-200 group-hover:text-white">${name}</span><span class="text-xs text-gray-500 group-hover:text-blue-200">${sizeText}</span>`;

            list.appendChild(btn);

        });

    }



    confirmNewCard(templateName) {
        document.getElementById('templateModal').classList.add('hidden');
        setTimeout(() => {
            try {
                this.loadTemplateFromLibrary(templateName);
                this.cardData = {};
                this.currentCardName = "新卡牌";
                this.currentDeck = "";
                this.isCardEditing = true;
                this.selectedId = null;

                // ★ 修正：初始化数据时必须使用 label 而不是 id
                this.template.forEach(el => {
                    if (el.type !== 'static-image') {
                        const initialText = (el.type === 'text') ? (el.defaultText || '') : '';
                        this.cardData[el.label] = { x: 0, y: 0, scale: 1, text: initialText };
                    }
                });

                document.getElementById('cardNameInput').value = this.currentCardName;
                document.getElementById('cardDeckInput').value = this.currentDeck;
                this.render();
                this.updateCardInputs();
            } catch (err) { console.error(err); }
        }, 50);
    }



    createNewDeck() {

        const name = prompt("请输入新卡组名称:");

        if (!name) return;

        this.currentDeck = name;

        document.getElementById('cardDeckInput').value = name;

        if (!this.decks.includes(name)) { this.decks.push(name); this.updateDeckUI(); }

        document.getElementById('deckFilter').value = name;

        this.updateCardSelectorUI();

    }


    saveTemplateToLibrary() {

        const name = this.currentTemplateName || "未命名模板";

        const templateObj = { name: name, width: this.width, height: this.height, elements: this.template.map(el => { const { src, ...rest } = el; return rest; }) };

        this.templateLibrary[name] = templateObj;

        if (this.saveStorage('cardForge_templates', this.templateLibrary)) {

            this.updateDesignerTemplateSelectorUI();

            document.getElementById('designerTemplateSelector').value = name;

            alert(`模板 "${name}" 已保存！`);

        }

    }



    saveCardToLibrary() {
        if (!this.isCardEditing) { alert("请先选择模板。"); return; }
        const name = this.currentCardName || "未命名卡牌";

        const existing = this.cardLibrary[name];
        const previousDeck = existing ? existing.deck : null;
        const cardObj = { name: name, deck: this.currentDeck || "默认卡组", templateName: this.currentTemplateName, data: {} };

        // 【修改点】：保存时使用 label 作为 Key
        this.template.forEach(el => {
            if (el.type !== 'static-image') {
                const dataSlot = this.cardData[el.label] || {};
                const { img, ...rest } = dataSlot;
                cardObj.data[el.label] = rest;
            }
        });

        // 排序逻辑...
        if (existing && previousDeck === cardObj.deck && typeof existing.order === 'number') {
            cardObj.order = existing.order;
        } else {
            cardObj.order = this.getNextCardOrder(cardObj.deck);
        }

        this.cardLibrary[name] = cardObj;
        this.normalizeDeckOrder(cardObj.deck);
        if (previousDeck && previousDeck !== cardObj.deck) this.normalizeDeckOrder(previousDeck);

        // 【修改点】：调用 saveDeck
        if (this.storage.saveDeck(cardObj.deck, this.cardLibrary)) {
            if (previousDeck && previousDeck !== cardObj.deck) this.storage.saveDeck(previousDeck, this.cardLibrary);

            this.decks = this.extractDecks();
            this.updateDeckUI();
            this.updateCardSelectorUI();
            this.isDeckDirty = true;
            alert(`卡牌 "${name}" 已保存！`);
        }
    }



    loadTemplateFromLibrary(name) {
        if (!name || !this.templateLibrary[name]) return;
        const data = this.templateLibrary[name];

        // 1. 更新基础元数据
        this.currentTemplateName = data.name || name;
        this.width = data.width || 400;
        this.height = data.height || 600;

        // 2. 深度拷贝元素，防止修改影响库
        this.template = JSON.parse(JSON.stringify(data.elements || []));
        if (Array.isArray(data)) this.template = JSON.parse(JSON.stringify(data)); // 兼容旧格式

        // 3. ★ 关键修复：重置选中状态并强制刷新 UI ★
        this.selectedId = null;            // 清除上个模板留下的选中 ID
        this.resizeCanvas();               // 调整画布尺寸
        this.updateTemplateSettingsUI();   // 更新名字/宽高输入框
        this.updateLayerList();            // 立即刷新下方的图层列表
        this.updatePropEditor();           // 重置属性编辑器（确保它是隐藏或清空的）

        // 4. 重新加载模板底图
        this.template.forEach(el => {
            const src = el.imagePath || el._srcData;
            if (el.type === 'static-image' && src) {
                const img = new Image();
                img.onload = () => { el.src = img; this.render(); };
                img.src = this.storage.getImgSource(src);
            }
        });

        // 5. 最后渲染一次
        this.render();
    }



    loadCardFromLibrary(name, options = {}) {
        const silent = !!options.silent;
        if (!name || !this.cardLibrary[name]) return;
        const cardObj = this.cardLibrary[name];

        // 1. 检查模板
        if (!cardObj.templateName || !this.templateLibrary[cardObj.templateName]) {
            alert(`错误：找不到模板 "${cardObj.templateName}"。`);
            return;
        }

        // 2. 加载模板
        this.loadTemplateFromLibrary(cardObj.templateName);

        // 3. 初始化数据结构 (核心修改：使用 el.label)
        this.cardData = {};
        this.template.forEach(el => {
            if (el.type !== 'static-image') {
                const initialText = (el.type === 'text') ? (el.defaultText || '') : '';
                this.cardData[el.label] = { x: 0, y: 0, scale: 1, text: initialText };
            }
        });

        // 4. 设置元数据
        this.currentCardName = cardObj.name;
        this.currentDeck = cardObj.deck || "默认卡组";
        this.isCardEditing = true;
        this.selectedId = null;

        if (!silent) {
            document.getElementById('cardNameInput').value = this.currentCardName;
            document.getElementById('cardDeckInput').value = this.currentDeck;
            document.getElementById('cardSelector').value = name;
        }

        // 5. 恢复具体数据 (核心修改：从 label 键读入)
        for (let label in cardObj.data) {
            if (this.cardData[label]) {
                Object.assign(this.cardData[label], cardObj.data[label]);

                const d = this.cardData[label];
                const src = d.imagePath || d._imgSrc;
                if (src) {
                    const img = new Image();
                    img.onload = () => { d.img = img; this.render(); };
                    img.src = this.storage.getImgSource(src);
                }
            }
        }

        if (!silent) {
            this.updateCardInputs();
            this.render();
            this.setMode('card');
        } else {
            this.render();
        }

        const designerSelector = document.getElementById('designerTemplateSelector');
        if (designerSelector) designerSelector.value = cardObj.templateName;
    }


    async deleteCardFromLibrary() {
        const name = document.getElementById('cardSelector').value;
        if (!name) return;

        if (confirm(`确定删除卡牌 "${name}" 吗？\n(关联的图片文件若被其他卡牌共用，将保留)`)) {
            const card = this.cardLibrary[name];
            const deckName = card ? card.deck : null;

            // 1. 智能删除图片
            if (card && card.data) {
                Object.values(card.data).forEach(slot => {
                    const pathToDelete = slot.imagePath;

                    if (pathToDelete) {
                        let isUsedByOthers = false;
                        // 遍历整个卡牌库检查引用
                        for (const key in this.cardLibrary) {
                            if (key === name) continue;
                            const otherCard = this.cardLibrary[key];
                            const hasRef = Object.values(otherCard.data).some(d => d.imagePath === pathToDelete);
                            if (hasRef) {
                                isUsedByOthers = true;
                                break;
                            }
                        }

                        if (!isUsedByOthers) {
                            this.storage.deleteFile(pathToDelete);
                        }
                    }
                });
            }

            // 2. 删除内存中的数据
            delete this.cardLibrary[name];

            // ★★★ 修复：删除了原本在这里的一行导致报错的代码 ★★★

            if (deckName) {
                this.normalizeDeckOrder(deckName);
            }

            // 3. 保存更新后的库 (这一步至关重要)
            this.saveStorage('cardForge_cards', this.cardLibrary);


            // ★ 核心修复：如果删除的是当前正在编辑的那张卡，彻底重置状态
            if (this.currentCardName === name) {
                this.template = [];        // 彻底清空画布上的模板结构
                this.cardData = {};        // 清空数据槽位
                this.selectedId = null;    // 清除选中框
                this.currentCardName = "";
                this.currentDeck = "";
                this.isCardEditing = false; // 标记为非编辑状态

                // 同步清空卡牌编辑页面的输入框
                document.getElementById('cardNameInput').value = "";
                document.getElementById('cardDeckInput').value = "";
                document.getElementById('cardSelector').value = "";

                // 关键：触发这个方法会显示那个“请新建或加载卡牌”的幽灵提示图
                this.updateCardInputs();
                this.render(); // 刷新画布为全空
            }

            this.isDeckDirty = true; // 标记卡组视图需要刷新
            alert("卡牌已删除");
        }
    }


    // --- 新增：重命名卡组 ---

    renameDeck(oldName) {

        if (oldName === 'ALL') return;



        const newName = prompt(`请输入 [${oldName}] 的新名称:`, oldName);



        // 如果取消、为空、或者名字没变，则不做处理

        if (!newName || newName.trim() === "" || newName === oldName) return;



        const finalName = newName.trim();

        let count = 0;



        // 1. 遍历并修改卡牌数据的 deck 属性

        Object.values(this.cardLibrary).forEach(card => {

            if (card.deck === oldName) {

                card.deck = finalName;

                count++;

            }

        });



        // 2. 保存更改

        this.saveStorage('cardForge_cards', this.cardLibrary);
        this.normalizeDeckOrder(finalName);


        // 3. 更新内部状态列表

        this.decks = this.extractDecks();



        // 4. 如果当前正在浏览旧卡组，视图切换到新卡组

        if (this.currentViewDeck === oldName) {

            this.currentViewDeck = finalName;

        }

        // 如果当前编辑器里选中的是旧卡组，也更新一下编辑器状态

        if (this.currentDeck === oldName) {

            this.currentDeck = finalName;

            document.getElementById('cardDeckInput').value = finalName;

        }



        // 5. 刷新所有 UI

        this.updateDeckUI();          // 下拉菜单

        this.updateCardSelectorUI();  // 卡牌选择器

        this.isDeckDirty = true;

        this.updateDeckGalleryUI();   // 列表视图



        // 提示结果（如果新名字已存在，会自动合并，这里提示语也可以暗示这一点）

        alert(`重命名成功！已将 ${count} 张卡牌归入 [${finalName}]。`);

    }



    // --- 新增：删除整个卡组 ---

    async deleteDeck(deckName) {
        if (deckName === 'ALL') return;

        const cardsInDeck = Object.values(this.cardLibrary).filter(c => c.deck === deckName);
        const count = cardsInDeck.length;

        const confirmMsg = count > 0
            ? `警告：卡组 [${deckName}] 包含 ${count} 张卡牌。\n删除卡组将【物理删除】JSON文件及所有关联的本地图片！\n\n确定要继续吗？`
            : `确定要删除空卡组 [${deckName}] 吗？`;

        if (!confirm(confirmMsg)) return;

        // 1. 物理清理：删除该卡组所有卡牌关联的图片文件
        cardsInDeck.forEach(card => {
            if (card.data) {
                Object.values(card.data).forEach(slot => {
                    // 如果是本地路径且没有被其他卡组引用（简单起见，这里直接调 deleteFile）
                    if (slot.imagePath) {
                        this.storage.deleteFile(slot.imagePath);
                    }
                });
            }
            // 从内存大库中移除这张卡
            delete this.cardLibrary[card.name];
        });

        // 2. 物理清理：删除硬盘上的 [卡组名].json 文件
        this.storage.deleteDeckFile(deckName);

        // 3. 更新内部状态
        this.decks = this.extractDecks();

        // 如果当前视图就在这个被删的卡组，切换到全部
        if (this.currentViewDeck === deckName) {
            this.currentViewDeck = 'ALL';
        }

        // 如果编辑器正在编辑这个卡组的卡，清空状态
        if (this.currentDeck === deckName) {
            this.currentDeck = "";
            this.isCardEditing = false;
            this.cardData = {};
            this.render();
        }

        // 4. 刷新所有 UI
        this.updateDeckUI();
        this.updateCardSelectorUI();
        this.isDeckDirty = true;
        this.updateDeckGalleryUI();

        alert(`卡组 [${deckName}] 及其文件已彻底删除。`);
    }


    // --- 步骤4修改：统一保存入口 ---
    saveStorage(key, data) {
        // 调用适配器保存，如果失败(返回false)，说明空间不足
        return this.storage.save(key, data);
    }

    clearLibrary(type) {
        if (confirm("确定要清空该库吗？此操作无法撤销！")) {
            if (type === 'template') {
                this.templateLibrary = {};
                this.saveStorage('cardForge_templates', {}); // 自动根据环境存硬盘或缓存
                this.updateDesignerTemplateSelectorUI();
                this.template = [];
            }
            // 如果需要清空卡牌库也可以加 else if...

            this.render();
            this.updateUI();
        }
    }

    // 注意：restoreAllData 方法里也有 saveStorage 调用，
    // 因为我们上面修改了 saveStorage 的内部实现，所以 restoreAllData 不需要改动，它会自动生效。



    updateDeckUI() {
        const dataList = document.getElementById('deckList');
        dataList.innerHTML = '';
        this.decks.forEach(deck => { const opt = document.createElement('option'); opt.value = deck; dataList.appendChild(opt); });

        const filter = document.getElementById('deckFilter');
        const currentFilter = filter.value; // 记录当前选中的卡组

        filter.innerHTML = '<option value="ALL">全部卡组</option>';
        this.decks.forEach(deck => {
            const opt = document.createElement('option');
            opt.value = deck;
            opt.innerText = deck;
            filter.appendChild(opt);
        });

        // 尝试恢复选中状态，如果该卡组被删没了，就自动切回 ALL
        if (Array.from(filter.options).some(o => o.value === currentFilter)) {
            filter.value = currentFilter;
        } else {
            filter.value = 'ALL';
        }
    }



    updateCardSelectorUI() {

        const selector = document.getElementById('cardSelector');

        const filterDeck = document.getElementById('deckFilter').value;

        const currentVal = selector.value;

        selector.innerHTML = '<option value="">-- 选择加载卡牌 --</option>';

        Object.values(this.cardLibrary).forEach(card => {

            if (filterDeck === 'ALL' || card.deck === filterDeck) {

                const opt = document.createElement('option'); opt.value = card.name; opt.innerText = card.name; selector.appendChild(opt);

            }

        });

        if (currentVal && Array.from(selector.options).some(o => o.value === currentVal)) { selector.value = currentVal; }

    }



    // --- 核心操作 ---



    addElement(type) {

        // 在 addElement 方法开头
        const id = generateId();
        // ★ 新增 alwaysShowInput: true 属性
        const baseProps = { id, type, x: 20, y: 20, w: 100, h: 100, alwaysShowInput: true };

        if (type === 'static-image') {

            this.template.push({ ...baseProps, label: '固定装饰', src: null });

        } else if (type === 'user-image') {

            this.template.push({ ...baseProps, label: '卡图区域', w: 150, h: 150 });

        } // 在 addElement(type) 方法中
        else if (type === 'text') {
            this.template.push({
                ...baseProps, label: '数值/文本', w: 200, h: 30,
                fontSize: 24, color: '#ffffff', fontFamily: 'Noto Sans SC',
                align: 'left', fontWeight: 'normal', fontStyle: 'normal',
                defaultText: '文本内容', multiline: false, lineHeight: 1.2,
                // --- ★ 新增属性 ---
                isOptions: false,      // 是否开启固定选项
                optionsList: ""        // 选项列表，用逗号隔开
            });
        }

        this.selectElement(id);

        this.render();

        this.updateLayerList();

        if (!this.cardData[baseProps.label]) {
            this.cardData[baseProps.label] = { x: 0, y: 0, scale: 1, text: '' };
        }

    }

    duplicateSelected() {
        if (!this.selectedId) return;

        const index = this.template.findIndex(el => el.id === this.selectedId);
        if (index === -1) return;

        const original = this.template[index];

        // 记录撤回记录 (如果有 undo 功能)
        if (this.pushHistory) this.pushHistory();

        // 1. 基础数据深度拷贝
        const copy = JSON.parse(JSON.stringify(original));

        // 2. ★ 核心修复：手动拷贝图片对象 ★
        // JSON 拷不走 original.src，我们需要手动指派，否则渲染副本时会因为找不到图片而报错
        if (original.src) {
            copy.src = original.src;
        }

        // 3. 保证 ID 和 Label 唯一
        copy.id = generateId();
        copy.label = `${original.label}_副本_${Math.floor(Math.random() * 1000)}`;

        // 4. 插入并选中
        this.template.splice(index + 1, 0, copy);
        this.selectElement(copy.id);

        // 5. 同步 cardData 结构
        if (copy.type !== 'static-image') {
            const initialText = (copy.type === 'text') ? (copy.defaultText || '') : '';
            this.cardData[copy.label] = { x: 0, y: 0, scale: 1, text: initialText };
        }

        this.updateLayerList();
        this.render();
    }

    deleteSelected() {
        if (!this.selectedId) return;

        // 1. 找到要删除的元素定义，以便获取它的 label (图层名)
        const elToDelete = this.template.find(el => el.id === this.selectedId);

        if (elToDelete) {
            // 2. 从 cardData 中删除对应的数据（现在使用 label 作为键名）
            // 这样可以确保内存中的数据与 UI 同步清理
            if (this.cardData[elToDelete.label]) {
                delete this.cardData[elToDelete.label];
                console.log(`[Data Deleted] 已清理图层数据: ${elToDelete.label}`);
            }
        }

        // 3. 从模板定义数组中移除该元素
        this.template = this.template.filter(el => el.id !== this.selectedId);

        // 4. 清空选中状态
        this.selectedId = null;

        // 5. 重新渲染画布并更新 UI 面板（如层级列表和属性面板）
        this.render();
        this.updateUI();
    }



    selectElement(id) { this.selectedId = id; this.updateUI(); this.render(); }



    moveLayer(dir) {

        if (!this.selectedId) return;

        const idx = this.template.findIndex(el => el.id === this.selectedId);

        const newIdx = idx + dir;

        if (newIdx >= 0 && newIdx < this.template.length) {

            [this.template[idx], this.template[newIdx]] = [this.template[newIdx], this.template[idx]];

            this.updateLayerList(); this.render();

        }

    }



    resizeCanvas() {

        this.canvas.width = this.width * this.scaleFactor;

        this.canvas.height = this.height * this.scaleFactor;

        this.canvas.style.width = `${this.width}px`;

        this.canvas.style.height = `${this.height}px`;

        this.interactionLayer.style.width = `${this.width}px`;

        this.interactionLayer.style.height = `${this.height}px`;

        document.getElementById('canvasSizeDisplay').innerText = `${this.width} x ${this.height}`;

        this.render();

    }

    // --- ★ 新增：单条逻辑计算助手 ---
    evaluateCondition(cond) {
        if (!cond.targetId) return true; // 如果还没选目标，默认放行

        let targetText = '';
        const targetEl = this.template.find(e => e.id === cond.targetId);
        if (targetEl && this.cardData[targetEl.label]) {
            targetText = this.cardData[targetEl.label].text;
        }

        const currentVal = String(targetText || '').trim();
        const triggerVal = String(cond.value || '').trim();
        const currentNum = parseFloat(currentVal);
        const triggerNum = parseFloat(triggerVal);
        const isNumeric = !isNaN(currentNum) && !isNaN(triggerNum);

        switch (cond.operator) {
            case 'not-empty': return currentVal !== '';
            case '!=': return currentVal !== triggerVal;
            case '>': return isNumeric ? currentNum > triggerNum : false;
            case '<': return isNumeric ? currentNum < triggerNum : false;
            case '>=': return isNumeric ? currentNum >= triggerNum : false;
            case '<=': return isNumeric ? currentNum <= triggerNum : false;
            default: return currentVal === triggerVal; // 默认 '=='
        }
    }

    checkVisibility(el) {
        // 1. 上帝视角：正在选中的图层必须可见
        if (this.selectedId === el.id) return true;

        // 2. 兼容并处理“始终隐藏”
        if (el.bindTargetId === 'manual-hide' || el.manualHide) return false;

        // 3. 数据无缝迁移 (旧的单一条件转为数组)
        if (!el.conditions) {
            el.conditions = [];
            if (el.bindTargetId && el.bindTargetId !== 'manual-hide') {
                el.conditions.push({
                    targetId: el.bindTargetId,
                    operator: el.bindTargetOperator || '==',
                    value: el.bindTargetValue || '',
                    logic: 'AND' // 默认第一个是 AND，虽然不起作用
                });
            }
        }

        // 4. 无条件则默认显示
        if (el.conditions.length === 0) return true;

        // 5. ★ 核心计算：从左到右链式计算多条件结果 ★
        let result = this.evaluateCondition(el.conditions[0]);
        for (let i = 1; i < el.conditions.length; i++) {
            const cond = el.conditions[i];
            const res = this.evaluateCondition(cond);
            if (cond.logic === 'OR') {
                result = result || res;
            } else {
                // 默认为 AND
                result = result && res;
            }
        }

        return result;
    }


    render() {

        const ctx = this.ctx;

        const sf = this.scaleFactor;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();

        ctx.scale(sf, sf);

        this.template.forEach(el => {
            // 1. 计算当前元素的可见性
            const isVisible = this.checkVisibility(el);

            // 2. ★ 新增：动态控制卡牌编辑面板中的输入框显示/隐藏
            if (this.mode === 'card') {
                const wrapper = document.getElementById(`input-wrapper-${el.id}`);
                if (wrapper) {
                    // 如果不勾选“始终显示”，且条件不满足，则隐藏对应的编辑框
                    if (el.alwaysShowInput === false && !isVisible) {
                        wrapper.classList.add('hidden');
                    } else {
                        wrapper.classList.remove('hidden');
                    }
                }
            }

            // 3. 如果检查通过，正常绘制图层
            if (isVisible) {
                this.renderElement(ctx, el);
            }
        });

        if (this.mode === 'template' && this.selectedId) {

            const el = this.template.find(e => e.id === this.selectedId);

            if (el) {

                ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);

                ctx.strokeRect(el.x, el.y, el.w, el.h);

                ctx.setLineDash([]);

                const handleSize = 8;

                ctx.fillStyle = '#3b82f6';

                ctx.fillRect(el.x + el.w - handleSize, el.y + el.h - handleSize, handleSize, handleSize);

                ctx.fillStyle = '#3b82f6';

                ctx.fillRect(el.x, el.y - 20, ctx.measureText(el.label).width + 10, 20);

                ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';

                ctx.fillText(el.label, el.x + 5, el.y - 5);

            }

        }

        ctx.restore();

    }



    renderElement(ctx, el) {
        // 【关键修改】：数据寻址从 el.id 改为 el.label
        const data = this.cardData[el.label];

        if (el.type === 'static-image') {
            if (el.src) {
                ctx.drawImage(el.src, el.x, el.y, el.w, el.h);
            } else if (this.mode === 'template') {
                ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(el.x, el.y, el.w, el.h);
                this.drawCenteredText(ctx, "固定图片区", el);
            }
        }
        // 在 renderElement 的 user-image 分支中修改
        else if (el.type === 'user-image') {
            ctx.save();
            ctx.beginPath(); ctx.rect(el.x, el.y, el.w, el.h); ctx.clip();

            if (data && data.img) {
                // --- 核心逻辑：计算“铺满”所需的最小缩放 ---
                const baseScale = Math.max(el.w / data.img.width, el.h / data.img.height);

                // 最终缩放 = 基准铺满缩放 * 用户定义的比例 (默认1)
                const userScale = (data.scale !== undefined) ? data.scale : 1;
                const finalScale = baseScale * userScale;

                const centerX = el.x + el.w / 2;
                const centerY = el.y + el.h / 2;
                const w = data.img.width * finalScale;
                const h = data.img.height * finalScale;

                const x = centerX - w / 2 + (data.x || 0);
                const y = centerY - h / 2 + (data.y || 0);

                ctx.drawImage(data.img, x, y, w, h);
            } else {
                // ... 未上传图片时的占位逻辑保持不变 ...
            }
            ctx.restore();
        }
        else if (el.type === 'text') {
            // 【关键修改】：优先从 cardData[el.label] 取值
            let text = el.label;
            if (this.mode === 'card' && data?.text !== undefined) {
                text = data.text;
            } else if (el.defaultText !== undefined) {
                text = el.defaultText;
            }

            const style = el.fontStyle || 'normal';
            const weight = el.fontWeight || 'normal';
            const family = el.fontFamily || 'Noto Sans SC';
            ctx.font = `${style} ${weight} ${el.fontSize}px "${family}"`;
            ctx.fillStyle = el.color; ctx.textAlign = el.align; ctx.textBaseline = 'top';

            let x = el.x;
            if (el.align === 'center') x += el.w / 2;
            if (el.align === 'right') x += el.w;

            if (el.multiline) {
                this.wrapText(ctx, text, x, el.y, el.w, el.fontSize * (el.lineHeight || 1.2));
            } else {
                ctx.fillText(text, x, el.y, el.w);
            }
        }
    }



    drawCenteredText(ctx, text, el) {

        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, el.x + el.w / 2, el.y + el.h / 2);

    }



    wrapText(ctx, text, x, y, maxWidth, lineHeight) {

        const words = text.split(''); let line = '';

        for (let n = 0; n < words.length; n++) {

            if (words[n] === '\n') { ctx.fillText(line, x, y); line = ''; y += lineHeight; continue; }

            let testLine = line + words[n];

            let metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && n > 0) { ctx.fillText(line, x, y); line = words[n]; y += lineHeight; } else { line = testLine; }

        }

        ctx.fillText(line, x, y);

    }



    updateUI() {
        document.getElementById('panelTemplate').classList.toggle('hidden', this.mode !== 'template');
        document.getElementById('panelCard').classList.toggle('hidden', this.mode !== 'card');
        document.getElementById('panelDeckView').classList.toggle('hidden', this.mode !== 'deck');

        document.getElementById('btnModeTemplate').classList.toggle('active', this.mode === 'template');
        document.getElementById('btnModeCard').classList.toggle('active', this.mode === 'card');
        document.getElementById('btnModeDeck').classList.toggle('active', this.mode === 'deck');

        // ★ 核心：右侧栏只在模板模式显示
        const rightPanel = document.getElementById('rightPanel');
        const resizerRight = document.getElementById('uiResizerRight');
        if (rightPanel) rightPanel.classList.toggle('hidden', this.mode !== 'template');
        if (resizerRight) resizerRight.classList.toggle('hidden', this.mode !== 'template');

        if (this.mode === 'template') {
            this.updateLayerList();
            this.updatePropEditor();
        } else if (this.mode === 'card') {
            this.updateCardInputs();
        }
    }



    updateLayerList() {

        const container = document.getElementById('layerList');

        container.innerHTML = '';

        [...this.template].reverse().forEach((el, revIndex) => {

            const div = document.createElement('div');

            div.className = `element-item p-2 mb-1 rounded cursor-pointer flex items-center justify-between ${el.id === this.selectedId ? 'selected' : 'text-gray-400'}`;

            div.onclick = () => this.selectElement(el.id);

            let icon = 'fa-square';

            if (el.type.includes('image')) icon = 'fa-image';

            if (el.type === 'text') icon = 'fa-font';

            div.innerHTML = `

                                <div class="flex items-center gap-2 overflow-hidden">

                                    <i class="fa-solid ${icon} text-xs w-4"></i>

                                    <span class="text-sm truncate select-none">${el.label}</span>

                                </div>

                                <span class="text-xs text-gray-600 font-mono">${el.type}</span>

                            `;

            container.appendChild(div);

        });

    }


    updatePropEditor() {
        const container = document.getElementById('propEditor');
        const emptyState = document.getElementById('emptyPropState');
        const dynamic = document.getElementById('dynamicProps');

        if (dynamic) dynamic.innerHTML = '';

        // 1. 如果没有选中任何图层，显示空状态提示并退出
        if (!this.selectedId) {
            if (container) { container.classList.add('hidden'); container.classList.remove('flex'); }
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        // 2. ★ 核心修复：找回丢失的图层数据寻址！★
        const el = this.template.find(e => e.id === this.selectedId);
        if (!el) return;

        // 3. 选中图层后，显示面板并隐藏提示
        if (container) { container.classList.remove('hidden'); container.classList.add('flex'); }
        if (emptyState) emptyState.classList.add('hidden');

        // ==== 基础坐标属性 ====
        this.bindInput('propLabel', el.label, v => el.label = v);
        this.bindInput('propX', el.x, v => el.x = parseInt(v));
        this.bindInput('propY', el.y, v => el.y = parseInt(v));
        this.bindInput('propW', el.w, v => el.w = parseInt(v));
        this.bindInput('propH', el.h, v => el.h = parseInt(v));

        // ==========================================
        // ★★★ 升级版：多条件显示设置区域 ★★★
        // ==========================================
        const conditionContainer = document.createElement('div');
        conditionContainer.className = "mt-4 pt-2 border-t border-gray-700/50 space-y-2";

        // 标题栏 + 添加按钮
        conditionContainer.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <label class="block text-xs font-bold text-blue-400"><i class="fa-solid fa-eye mr-1"></i>显示条件</label>
                <button id="btnAddCondition" class="text-[10px] bg-blue-700 hover:bg-blue-600 text-white px-2 py-0.5 rounded transition-colors shadow-sm active:scale-95">
                    <i class="fa-solid fa-plus mr-1"></i>加条件
                </button>
            </div>
        `;

        // 数据迁移确保结构安全
        if (!el.conditions) {
            el.conditions = [];
            if (el.bindTargetId && el.bindTargetId !== 'manual-hide') {
                el.conditions.push({ targetId: el.bindTargetId, operator: el.bindTargetOperator || '==', value: el.bindTargetValue || '', logic: 'AND' });
            }
        }

        // 特殊开关：始终隐藏
        const isManualHide = el.bindTargetId === 'manual-hide' || el.manualHide;
        this.createCheckboxProp(conditionContainer, '始终隐藏 (不渲染)', isManualHide, v => {
            el.manualHide = v;
            if (v) el.bindTargetId = 'manual-hide';
            else if (el.bindTargetId === 'manual-hide') el.bindTargetId = null;
            this.updatePropEditor();
            this.render();
        });

        // 只有在非“始终隐藏”状态下，才显示条件列表
        if (!isManualHide && el.bindTargetId !== 'manual-hide') {

            // 特殊开关：不满足时是否保留左侧编辑面板
            const isAlwaysShow = el.alwaysShowInput !== false;
            this.createCheckboxProp(conditionContainer, '隐藏图层时，保留左侧输入框', isAlwaysShow, v => {
                el.alwaysShowInput = v;
                this.render();
            });

            // 渲染条件列表
            const listDiv = document.createElement('div');
            listDiv.className = "space-y-1.5 mt-2";

            if (el.conditions.length === 0) {
                listDiv.innerHTML = `<div class="text-center text-[10px] text-gray-500 py-3 border border-dashed border-gray-700 rounded bg-black/20">无条件限制，始终显示</div>`;
            }

            el.conditions.forEach((cond, index) => {
                const row = document.createElement('div');
                row.className = "flex flex-wrap gap-1 items-center p-1.5 bg-gray-900 border border-gray-700 rounded relative group";

                const delBtn = document.createElement('button');
                delBtn.className = "absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 text-red-500 bg-black rounded-full w-4 h-4 flex items-center justify-center border border-gray-700 hover:bg-red-500 hover:text-white transition-all text-[8px] z-10";
                delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                delBtn.onclick = () => {
                    el.conditions.splice(index, 1);
                    this.updatePropEditor();
                    this.render();
                };
                row.appendChild(delBtn);

                if (index > 0) {
                    const logicSel = document.createElement('select');
                    logicSel.className = "p-1 rounded bg-gray-800 border border-gray-600 text-[10px] text-yellow-500 font-bold focus:outline-none";
                    ['AND', 'OR'].forEach(lg => {
                        const o = document.createElement('option'); o.value = lg; o.text = lg === 'AND' ? '且' : '或';
                        if (cond.logic === lg) o.selected = true;
                        logicSel.appendChild(o);
                    });
                    logicSel.onchange = (e) => { cond.logic = e.target.value; this.render(); };
                    row.appendChild(logicSel);
                }

                const targetSel = document.createElement('select');
                targetSel.className = "flex-1 min-w-[70px] p-1 rounded bg-gray-800 border border-gray-700 text-[10px] text-gray-300 focus:outline-none focus:border-blue-500";
                targetSel.innerHTML = '<option value="">选择目标...</option>';
                this.template.forEach(t => {
                    if (t.type === 'text' && t.id !== el.id) {
                        const o = document.createElement('option');
                        o.value = t.id; o.text = `[${t.label}]`;
                        if (t.id === cond.targetId) o.selected = true;
                        targetSel.appendChild(o);
                    }
                });
                targetSel.onchange = (e) => { cond.targetId = e.target.value; this.render(); };
                row.appendChild(targetSel);

                const opSel = document.createElement('select');
                opSel.className = "w-14 p-1 rounded bg-gray-800 border border-gray-700 text-[10px] text-gray-300 focus:outline-none focus:border-blue-500";
                const ops = [{ v: '==', t: "=" }, { v: '!=', t: "≠" }, { v: '>', t: ">" }, { v: '<', t: "<" }, { v: '>=', t: "≥" }, { v: '<=', t: "≤" }, { v: 'not-empty', t: "有字" }];
                ops.forEach(opt => {
                    const o = document.createElement('option'); o.value = opt.v; o.text = opt.t;
                    if (cond.operator === opt.v) o.selected = true;
                    opSel.appendChild(o);
                });
                opSel.onchange = (e) => {
                    cond.operator = e.target.value;
                    this.updatePropEditor();
                    this.render();
                };
                row.appendChild(opSel);

                if (cond.operator !== 'not-empty') {
                    const valInput = document.createElement('input');
                    valInput.type = "text";
                    valInput.className = "w-16 flex-1 p-1 rounded bg-gray-800 border border-gray-700 text-[10px] text-blue-300 focus:outline-none focus:border-blue-500 placeholder-gray-600";
                    valInput.placeholder = "值...";
                    valInput.value = cond.value || "";
                    valInput.oninput = (e) => { cond.value = e.target.value; this.render(); };
                    row.appendChild(valInput);
                }

                listDiv.appendChild(row);
            });
            conditionContainer.appendChild(listDiv);

            conditionContainer.querySelector('#btnAddCondition').onclick = () => {
                el.conditions.push({ targetId: '', operator: '==', value: '', logic: el.conditions.length > 0 ? 'AND' : 'AND' });
                this.updatePropEditor();
                this.render();
            };
        }

        dynamic.appendChild(conditionContainer);
        // ==========================================
        // ★★★ 条件设置结束 ★★★
        // ==========================================

        // ==== 静态图属性 ====
        if (el.type === 'static-image') {
            this.createFileProp(dynamic, '上传底图', async file => {
                const result = await this.storage.handleImageUpload(file);
                if (!result) return;
                const src = (result instanceof Promise) ? await result : result;
                el.imagePath = src;
                el._srcData = null;
                const img = new Image();
                img.onload = () => { el.src = img; this.render(); };
                img.src = this.storage.getImgSource(src);
            });
        }

        // ==== 文本属性 ====
        else if (el.type === 'text') {
            const textContainer = document.createElement('div');
            textContainer.className = "mb-2 pb-2 border-b border-gray-700/50";
            textContainer.innerHTML = `<label class="block text-gray-500 mb-1">默认显示文本</label>`;

            const textInput = document.createElement(el.multiline ? 'textarea' : 'input');
            if (!el.multiline) textInput.type = "text";
            else textInput.rows = 3;

            textInput.className = "w-full p-1.5 rounded bg-gray-900 border border-gray-700 text-gray-200 focus:border-blue-500 transition-colors";
            textInput.value = el.defaultText || '';
            textInput.placeholder = "在此输入模板上的默认文字...";
            textInput.oninput = (e) => {
                el.defaultText = e.target.value;
                this.render();
            };
            textContainer.appendChild(textInput);
            dynamic.appendChild(textContainer);

            this.createColorProp(dynamic, '颜色', el.color, v => el.color = v);
            this.createNumberProp(dynamic, '字号', el.fontSize, v => el.fontSize = parseInt(v));

            const fonts = ['Noto Sans SC', 'Noto Serif SC', 'Arial', 'Times New Roman', 'Courier New', 'SimSun', 'SimHei', 'Microsoft YaHei', 'KaiTi', 'FangSong'];
            this.createSelectProp(dynamic, '字体', el.fontFamily, fonts, v => el.fontFamily = v);
            this.createSelectProp(dynamic, '粗细', el.fontWeight || 'normal', ['normal', 'bold'], v => el.fontWeight = v);
            this.createSelectProp(dynamic, '样式', el.fontStyle || 'normal', ['normal', 'italic'], v => el.fontStyle = v);
            this.createSelectProp(dynamic, '对齐', el.align, ['left', 'center', 'right'], v => el.align = v);

            this.createCheckboxProp(dynamic, '多行文本', el.multiline, v => {
                el.multiline = v;
                this.updatePropEditor();
                this.render();
            });

            this.createCheckboxProp(dynamic, '固定选项', el.isOptions, v => {
                el.isOptions = v;
                this.updatePropEditor();
                this.render();
            });

            if (el.isOptions) {
                const optContainer = document.createElement('div');
                optContainer.className = "mt-1 p-2 bg-black/20 rounded border border-gray-700";
                optContainer.innerHTML = `<label class="block text-[10px] text-gray-500 mb-1">选项列表 (用中文或英文逗号隔开)</label>`;

                const optInput = document.createElement('textarea');
                optInput.className = "w-full p-1 rounded bg-gray-900 text-xs border border-gray-700 focus:border-blue-500 outline-none";
                optInput.rows = 2;
                optInput.placeholder = "例如：火,水,木,光,暗";
                optInput.value = el.optionsList || "";

                optInput.oninput = (e) => {
                    el.optionsList = e.target.value;
                    const firstOpt = el.optionsList.split(/[,，]/)[0].trim();
                    if (this.cardData[el.label] && !this.cardData[el.label].text) {
                        this.cardData[el.label].text = firstOpt;
                    }
                    this.render();
                };
                optContainer.appendChild(optInput);
                dynamic.appendChild(optContainer);
            }
        }
    }


    updateCardInputs() {
        const container = document.getElementById('cardInputs');
        container.innerHTML = '';

        // 1. 检查是否处于编辑状态
        if (!this.isCardEditing) {
            container.innerHTML = `<div class="text-center text-gray-500 mt-10"><i class="fa-solid fa-ghost text-2xl mb-2"></i><p>请在上方点击“新建卡牌”或加载已有卡牌</p></div>`;
            return;
        }

        // 2. 过滤出可编辑元素（排除固定装饰图）
        const inputs = this.template.filter(el => el.type !== 'static-image');

        if (inputs.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 mt-10"><p>该模板没有可编辑的元素</p></div>`;
            return;
        }

        inputs.forEach(el => {
            const wrapper = document.createElement('div');
            // ★ 新增：分配唯一 ID 并加上动画过渡效果
            wrapper.id = `input-wrapper-${el.id}`;
            wrapper.className = "bg-gray-800 p-3 rounded border border-gray-700 transition-all duration-300";

            // ★ 新增：初始化时判断是否应该隐藏
            const isVisible = this.checkVisibility(el);
            if (el.alwaysShowInput === false && !isVisible) {
                wrapper.classList.add('hidden');
            }

            const label = document.createElement('label');
            label.className = "block text-xs font-bold text-gray-400 mb-2";
            label.innerText = el.label;
            wrapper.appendChild(label);

            // ★★★ 核心修改点：使用 el.label 代替 el.id ★★★
            if (!this.cardData[el.label]) {
                this.cardData[el.label] = { text: '', scale: 1, x: 0, y: 0 };
            }
            const data = this.cardData[el.label];

            // --- 处理文本输入 ---
            // 在 updateCardInputs 方法内部循环 inputs.forEach(el => { ... }) 里的文本处理逻辑：

            if (el.type === 'text') {
                const finalVal = (data.text !== undefined) ? data.text : (el.defaultText || '');
                let input;

                // --- ★ 核心逻辑：判断是否为固定选项模式 ---
                if (el.isOptions && el.optionsList) {
                    input = document.createElement('select');
                    // 支持中英文逗号分隔，并过滤掉空格和空值
                    const options = el.optionsList.split(/[,，]/).map(s => s.trim()).filter(s => s);

                    options.forEach(optText => {
                        const opt = document.createElement('option');
                        opt.value = optText;
                        opt.text = optText;
                        if (optText === finalVal) opt.selected = true;
                        input.appendChild(opt);
                    });

                    // 如果当前值不在选项里，自动校正为第一个选项
                    if (options.length > 0 && !options.includes(finalVal)) {
                        data.text = options[0];
                        this.render();
                    }
                }
                // 原有的多行/单行文本逻辑
                else if (el.multiline) {
                    input = document.createElement('textarea');
                    input.rows = 3;
                    input.value = finalVal;
                } else {
                    input = document.createElement('input');
                    input.type = "text";
                    input.value = finalVal;
                }

                input.className = "w-full p-2 text-sm rounded bg-gray-900 text-white border border-transparent focus:border-blue-500 outline-none";

                // 统一绑定事件
                input.onchange = (e) => { // 下拉框用 onchange 更稳
                    data.text = e.target.value;
                    this.render();
                };
                // 文本框保留 oninput 实现实时预览
                if (input.tagName !== 'SELECT') {
                    input.oninput = (e) => {
                        data.text = e.target.value;
                        this.render();
                    };
                }

                wrapper.appendChild(input);
            }

            // --- 处理图片上传 ---
            else if (el.type === 'user-image') {
                const fileBtn = document.createElement('input');
                fileBtn.type = 'file';
                fileBtn.accept = 'image/*';
                fileBtn.className = "block w-full text-xs text-gray-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-700 file:text-white hover:file:bg-gray-600";

                // 在 updateCardInputs 的 fileBtn.onchange 内部
                fileBtn.onchange = async (e) => {
                    if (e.target.files[0]) {
                        const result = await this.storage.handleImageUpload(e.target.files[0]);
                        if (!result) return;

                        const src = (result instanceof Promise) ? await result : result;
                        data.imagePath = src;
                        data._imgSrc = null;

                        const img = new Image();
                        img.onload = () => {
                            // ★ 改动：上传新图时，默认缩放直接设为 1 (代表基准铺满)
                            data.scale = 1;
                            data.img = img;
                            this.render();

                            const slider = wrapper.querySelector('input[type="range"]');
                            if (slider) slider.value = 1;
                        };
                        img.src = this.storage.getImgSource(src);
                    }
                };
                wrapper.appendChild(fileBtn);

                // 缩放滑块
                const scaleRow = document.createElement('div');
                scaleRow.className = "flex items-center gap-2 mt-2";
                scaleRow.innerHTML = `<span class="text-xs text-gray-500">缩放</span>`;

                const range = document.createElement('input');
                range.type = "range";
                range.min = 0.01;
                range.max = 3;
                range.step = 0.01;
                range.value = data.scale || 1;
                range.className = "flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer";

                range.oninput = (e) => {
                    data.scale = parseFloat(e.target.value);
                    this.render();
                };

                scaleRow.appendChild(range);
                wrapper.appendChild(scaleRow);
            }

            container.appendChild(wrapper);
        });
    }



    bindInput(id, val, setter) { const el = document.getElementById(id); el.value = val; el.oninput = (e) => { setter(e.target.value); this.updateLayerList(); this.render(); }; }

    createInputProp(parent, label, val, setter) { const div = document.createElement('div'); div.innerHTML = `<label class="block text-gray-500">${label}</label>`; const input = document.createElement('input'); input.type = "text"; input.className = "w-full p-1 rounded bg-gray-800"; input.value = val; input.oninput = (e) => { setter(e.target.value); this.render(); }; div.appendChild(input); parent.appendChild(div); }

    createNumberProp(parent, label, val, setter) { const div = document.createElement('div'); div.innerHTML = `<label class="block text-gray-500">${label}</label>`; const input = document.createElement('input'); input.type = "number"; input.className = "w-full p-1 rounded bg-gray-800"; input.value = val; input.oninput = (e) => { setter(e.target.value); this.render(); }; div.appendChild(input); parent.appendChild(div); }

    createColorProp(parent, label, val, setter) { const div = document.createElement('div'); div.className = "flex justify-between items-center"; div.innerHTML = `<label class="text-gray-500">${label}</label>`; const input = document.createElement('input'); input.type = "color"; input.className = "h-6 w-12 bg-transparent border-0"; input.value = val; input.oninput = (e) => { setter(e.target.value); this.render(); }; div.appendChild(input); parent.appendChild(div); }

    createSelectProp(parent, label, val, options, setter) { const div = document.createElement('div'); div.innerHTML = `<label class="block text-gray-500">${label}</label>`; const select = document.createElement('select'); select.className = "w-full p-1 rounded bg-gray-800 text-xs"; options.forEach(opt => { const o = document.createElement('option'); o.value = opt; o.text = opt; o.selected = opt === val; select.appendChild(o); }); select.onchange = (e) => { setter(e.target.value); this.render(); }; div.appendChild(select); parent.appendChild(div); }

    createFileProp(parent, label, callback) { const div = document.createElement('div'); div.innerHTML = `<label class="block text-gray-500 mb-1">${label}</label>`; const btn = document.createElement('button'); btn.className = "w-full bg-gray-700 hover:bg-gray-600 text-xs py-1 rounded text-white"; btn.innerText = "选择文件..."; const input = document.createElement('input'); input.type = "file"; input.accept = "image/*"; input.className = "hidden"; input.onchange = (e) => { if (e.target.files[0]) callback(e.target.files[0]); }; btn.onclick = () => input.click(); div.appendChild(btn); div.appendChild(input); parent.appendChild(div); }


    setupPanelResizer() {
        const workspace = document.getElementById('workspaceContainer');

        // --- 左侧大纲栏拖拽 ---
        const resizerLeft = document.getElementById('uiResizer');
        const leftPanel = document.getElementById('leftPanel');
        if (resizerLeft && leftPanel) {
            let isResizingLeft = false;
            resizerLeft.addEventListener('mousedown', () => {
                isResizingLeft = true;
                document.body.style.cursor = 'col-resize';
                workspace.style.pointerEvents = 'none';
            });
            window.addEventListener('mousemove', (e) => {
                if (!isResizingLeft) return;
                let newWidth = e.clientX;
                if (newWidth < 200) newWidth = 200;
                if (newWidth > 600) newWidth = 600;
                leftPanel.style.width = `${newWidth}px`;
            });
            window.addEventListener('mouseup', () => {
                if (isResizingLeft) {
                    isResizingLeft = false;
                    document.body.style.cursor = 'default';
                    workspace.style.pointerEvents = 'auto';
                }
            });
        }

        // --- 右侧属性栏拖拽 ---
        const resizerRight = document.getElementById('uiResizerRight');
        const rightPanel = document.getElementById('rightPanel');
        if (resizerRight && rightPanel) {
            let isResizingRight = false;
            resizerRight.addEventListener('mousedown', () => {
                isResizingRight = true;
                document.body.style.cursor = 'col-resize';
                workspace.style.pointerEvents = 'none';
            });
            window.addEventListener('mousemove', (e) => {
                if (!isResizingRight) return;
                let newWidth = window.innerWidth - e.clientX;
                if (newWidth < 240) newWidth = 240;
                if (newWidth > 600) newWidth = 600;
                rightPanel.style.width = `${newWidth}px`;
            });
            window.addEventListener('mouseup', () => {
                if (isResizingRight) {
                    isResizingRight = false;
                    document.body.style.cursor = 'default';
                    workspace.style.pointerEvents = 'auto';
                }
            });
        }
    }


    setupEvents() {
        const layer = this.interactionLayer;
        const workspace = document.getElementById('workspaceContainer');

        // ★ 缩放逻辑 (放在这里)
        workspace.addEventListener('wheel', (e) => {
            if (this.mode === 'deck') return;
            e.preventDefault();
            const delta = -Math.sign(e.deltaY) * 0.1;
            this.viewZoom = Math.min(Math.max(0.2, this.viewZoom + delta), 3.0);
            this.updateCanvasZoom();
        }, { passive: false });

        // --- 拖拽状态变量 ---
        let isDragging = false;
        let isResizing = false;
        let dragPending = false;

        let startX, startY; // 鼠标按下的初始位置
        let initialElX, initialElY, initialElW, initialElH; // 元素的初始位置/尺寸
        let initialImgX, initialImgY; // 用户图片的偏移初始值

        const handleSize = 20; // 缩放手柄感应区
        const dragThreshold = 3; // 拖拽阈值（位移超过3px才认为是在拖拽）

        // 获取校正后的鼠标坐标 (考虑 Canvas 缩放)
        const getPos = (e) => {
            const rect = layer.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) / this.viewZoom,
                y: (e.clientY - rect.top) / this.viewZoom
            };
        };

        // --- 1. 鼠标按下 ---
        layer.addEventListener('mousedown', (e) => {
            const pos = getPos(e);
            startX = pos.x;
            startY = pos.y;

            if (this.mode === 'template') {
                // A. 判定是否点击了“缩放手柄”
                if (this.selectedId) {
                    const el = this.template.find(e => e.id === this.selectedId);
                    if (el && pos.x >= el.x + el.w - handleSize && pos.x <= el.x + el.w + 5 &&
                        pos.y >= el.y + el.h - handleSize && pos.y <= el.y + el.h + 5) {
                        isResizing = true;
                        initialElW = el.w;
                        initialElH = el.h;
                        return; // 缩放逻辑结束
                    }
                }

                // B. 判定点击了哪个图层
                let hit = null;
                // 优先检查当前已选中的图层
                if (this.selectedId) {
                    const cur = this.template.find(el => el.id === this.selectedId);
                    if (cur && pos.x >= cur.x && pos.x <= cur.x + cur.w && pos.y >= cur.y && pos.y <= cur.y + cur.h) {
                        hit = cur;
                    }
                }
                // 如果没点中已选的，寻找最上层的新图层
                if (!hit) {
                    hit = [...this.template].reverse().find(el =>
                        pos.x >= el.x && pos.x <= el.x + el.w && pos.y >= el.y && pos.y <= el.y + el.h
                    );
                }

                if (hit) {
                    if (this.selectedId === hit.id) {
                        // ★ 核心逻辑：如果是已选中的图层按下，准备拖拽
                        dragPending = true;
                        initialElX = hit.x;
                        initialElY = hit.y;
                    } else {
                        // ★ 核心逻辑：如果是未选中的图层点击，仅切换选中
                        this.selectElement(hit.id);
                        dragPending = false;
                    }
                } else {
                    // 点击空白处取消选中
                    this.selectedId = null;
                    dragPending = false;
                    this.updateUI();
                    this.render();
                }
            }
            else if (this.mode === 'card') {
                // 卡牌模式下的图片拖拽逻辑
                const hit = [...this.template].reverse().find(el =>
                    el.type === 'user-image' &&
                    pos.x >= el.x && pos.x <= el.x + el.w && pos.y >= el.y && pos.y <= el.y + el.h
                );
                if (hit && this.cardData[hit.label]?.img) {
                    if (this.selectedId === hit.id) {
                        dragPending = true;
                        initialImgX = this.cardData[hit.label].x || 0;
                        initialImgY = this.cardData[hit.label].y || 0;
                    } else {
                        this.selectElement(hit.id);
                        dragPending = false;
                    }
                }
            }
        });

        // --- 2. 鼠标移动 ---
        window.addEventListener('mousemove', (e) => {
            const pos = getPos(e);
            const dx = pos.x - startX;
            const dy = pos.y - startY;

            // 处理缩放
            if (isResizing && this.selectedId) {
                const el = this.template.find(e => e.id === this.selectedId);
                if (el) {
                    el.w = Math.max(10, initialElW + dx);
                    el.h = Math.max(10, initialElH + dy);
                    this.updatePropEditor();
                    this.render();
                }
                return;
            }

            // 处理拖拽检测：如果有 dragPending 且 移动距离超过阈值，开启 isDragging
            if (dragPending && !isDragging) {
                if (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold) {
                    isDragging = true;
                    layer.style.cursor = 'move';
                }
            }

            // 执行拖拽位移
            if (isDragging && this.selectedId) {
                if (this.mode === 'template') {
                    const el = this.template.find(e => e.id === this.selectedId);
                    if (el) {
                        el.x = initialElX + dx;
                        el.y = initialElY + dy;
                        this.updatePropEditor();
                        this.render();
                    }
                } else if (this.mode === 'card') {
                    const el = this.template.find(e => e.id === this.selectedId);
                    if (el && this.cardData[el.label]) {
                        this.cardData[el.label].x = initialImgX + dx;
                        this.cardData[el.label].y = initialImgY + dy;
                        this.render();
                    }
                }
            }
        });

        // --- 3. 鼠标松开 ---
        window.addEventListener('mouseup', () => {
            isDragging = false;
            isResizing = false;
            dragPending = false;
            layer.style.cursor = 'default';
        });

        // --- 4. 按钮绑定 (保持原有不变) ---
        document.getElementById('btnModeTemplate').onclick = () => this.setMode('template');
        document.getElementById('btnModeCard').onclick = () => this.setMode('card');
        document.getElementById('btnModeDeck').onclick = () => this.setMode('deck');
        document.getElementById('btnGlobalExport').onclick = () => this.exportCurrentCardImage();
    }

    /**
 * 导出包含图片资源的完整模板包
 */
    async exportTemplatePackage() {
        const name = this.currentTemplateName || "未命名模板";
        const tpl = this.templateLibrary[name];
        if (!tpl) { alert("请先在上方保存当前模板。"); return; }

        const fs = this.storage.fs;
        const path = this.storage.path;
        const assets = {};

        // 1. 扫描 static-image 元素并读取图片转为 Base64
        const elements = tpl.elements || [];
        for (const el of elements) {
            if (el.type === 'static-image' && el.imagePath) {
                try {
                    // ★ 核心修复：使用 this.storage.basePath
                    const fullPath = path.join(this.storage.basePath, el.imagePath);
                    if (fs.existsSync(fullPath)) {
                        assets[path.basename(el.imagePath)] = fs.readFileSync(fullPath).toString('base64');
                    }
                } catch (err) { console.warn("读取图片失败:", el.imagePath); }
            }
        }

        const packageData = { bundleType: "cardforge-pkg", name, config: tpl, assets };

        const blob = new Blob([JSON.stringify(packageData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.sanitizeFileName(name)}.cfpkg`;
        a.click();
    }

    /**
     * 导入完整模板包并还原图片到本地
     */
    async importTemplatePackage(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const pkg = JSON.parse(e.target.result);
                if (pkg.bundleType !== "cardforge-pkg") { alert("非有效的完整包文件！"); return; }

                const fs = this.storage.fs;
                const path = this.storage.path;
                const assets = pkg.assets || {};
                const tplConfig = pkg.config;

                // 1. 将 Base64 图片还原到 saved_data/images 目录
                for (const [fileName, b64Data] of Object.entries(assets)) {
                    const relativePath = `saved_data/images/${fileName}`;

                    // ★ 核心修复：使用 this.storage.basePath 将包里的图片解压到当前仓库
                    const fullSavePath = path.join(this.storage.basePath, relativePath);
                    if (!fs.existsSync(fullSavePath)) {
                        fs.writeFileSync(fullSavePath, Buffer.from(b64Data, 'base64'));
                    }
                    // 2. 修正模板配置中的路径
                    tplConfig.elements.forEach(el => {
                        if (el.imagePath && el.imagePath.endsWith(fileName)) el.imagePath = relativePath;
                    });
                }

                // 3. 写入库并刷新 UI
                this.templateLibrary[pkg.name] = tplConfig;
                this.saveStorage('cardForge_templates', this.templateLibrary);
                this.updateDesignerTemplateSelectorUI();
                this.loadTemplateFromLibrary(pkg.name);
                alert(`导入成功：[${pkg.name}]`);
            } catch (err) { console.error(err); alert("导入失败"); }
        };
        reader.readAsText(file);
    }


    exportTemplate() {

        const templateObj = { name: this.currentTemplateName, width: this.width, height: this.height, elements: this.template.map(el => { const { src, ...rest } = el; return rest; }) };

        const blob = new Blob([JSON.stringify(templateObj)], { type: 'application/json' });

        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${this.currentTemplateName}_template.json`; a.click();

    }



    exportCardData() {

        const content = {}; for (let id in this.cardData) { const { img, ...rest } = this.cardData[id]; content[id] = rest; }

        const exportObj = { templateName: this.currentTemplateName, data: content };

        const blob = new Blob([JSON.stringify(exportObj)], { type: 'application/json' });

        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'card_data.json'; a.click();

    }

    async importMarkdown() {
        const chooser = document.createElement('input');
        chooser.type = 'file';
        chooser.accept = '.md';

        chooser.onchange = async (e) => {
            if (!e.target.files.length) return;

            const file = e.target.files[0];
            const filePath = file.path; // 文件的绝对路径
            const deckName = file.name.replace(/\.[^/.]+$/, "");

            // ★ 获取文件所在的目录路径
            const baseDir = this.storage.path.dirname(filePath);

            try {
                const content = this.storage.fs.readFileSync(filePath, 'utf8');
                // ★ 传入 baseDir 供解析图片路径使用
                const newCards = this.parseMarkdownToCards(content, deckName, baseDir);

                Object.assign(this.cardLibrary, newCards);
                await this.storage.saveDeck(deckName, this.cardLibrary);

                this.decks = this.extractDecks();
                this.updateDeckUI();
                this.updateCardSelectorUI();
                this.isDeckDirty = true;
                if (this.mode === 'deck') this.updateDeckGalleryUI();

                alert(`导入成功！卡组 [${deckName}] 包含 ${Object.keys(newCards).length} 张卡牌。`);
            } catch (err) {
                console.error(err);
                alert("导入失败，请检查文件权限或格式。");
            }
        };
        chooser.click();
    }

    /**
     * 解析 Markdown 文本为卡牌对象库 (增强路径探测与坐标解析版)
     * @param {string} content - Markdown 文本内容
     * @param {string} deckName - 卡组名称
     * @param {string} baseDir - 笔记文件所在的绝对路径
     */
    parseMarkdownToCards(content, deckName, baseDir) {
        const sections = content.split('### @');
        const cardsObj = {};
        let orderIdx = 1;

        const fs = this.storage.fs;
        const path = this.storage.path;

        sections.forEach(section => {
            if (!section.trim()) return;
            const lines = section.split('\n');
            const rawTemplate = lines[0].trim();
            // 保留“打牌_”前缀，确保导入导出一致性
            const templateName = rawTemplate;

            const cardBlocks = section.split('#### #');
            cardBlocks.shift();

            cardBlocks.forEach(block => {
                const bLines = block.split('\n');
                const name = bLines[0].trim();
                if (!name || name === "") return;

                const card = {
                    name: name,
                    deck: deckName,
                    templateName: templateName,
                    order: orderIdx++,
                    data: {
                        // 自动生成“卡名”字段，对应模板中的文字图层
                        '卡名': { text: name }
                    }
                };

                let currentBlockKey = null;
                let blockContent = [];
                let isJustStartedBlock = false;

                for (let i = 1; i < bLines.length; i++) {
                    const rawLine = bLines[i];
                    const trimmedLine = rawLine.trim();

                    // 1. 处理多行大括号模式 ({} 块)
                    if (currentBlockKey) {
                        if (trimmedLine.includes('}')) {
                            const lastPart = rawLine.split('}')[0];
                            if (lastPart.trim()) blockContent.push(lastPart);
                            card.data[currentBlockKey] = { text: blockContent.join('\n') };
                            // 状态重置
                            currentBlockKey = null;
                            blockContent = [];
                            isJustStartedBlock = false;
                        } else {
                            // 拦截紧跟在 { 后的第一个换行
                            if (isJustStartedBlock && trimmedLine === "") {
                                isJustStartedBlock = false;
                                continue;
                            }
                            isJustStartedBlock = false;
                            blockContent.push(rawLine); // 保留缩进
                        }
                        continue;
                    }

                    if (!trimmedLine) continue;

                    // 2. 图片匹配与智能路径探测
                    const stdImgMatch = trimmedLine.match(/!\[\]\((.+?)\)/);
                    const obsidianImgMatch = trimmedLine.match(/!\[\[(.+?)(?:\|.*)?\]\]/);

                    if (stdImgMatch || obsidianImgMatch) {
                        let imgPath = "";
                        if (stdImgMatch) {
                            imgPath = stdImgMatch[1];
                        } else {
                            const capturedPath = obsidianImgMatch[1];
                            // 探测逻辑：
                            // pathA: 原始链接路径 (可能已包含 attachments/)
                            let pathA = path.join(baseDir, capturedPath);
                            // pathB: 尝试补上 attachments/ 前缀
                            let pathB = path.join(baseDir, "attachments", capturedPath);
                            // pathC: 即使链接里有路径，也强制去 attachments 根目录找文件名
                            let pathC = path.join(baseDir, "attachments", path.basename(capturedPath));

                            if (fs.existsSync(pathA)) imgPath = pathA;
                            else if (fs.existsSync(pathB)) imgPath = pathB;
                            else if (fs.existsSync(pathC)) imgPath = pathC;
                            else imgPath = pathA; // 找不到则保留原始拼接
                        }

                        // 采用增量更新，默认缩放为 1 (100% 铺满)
                        if (!card.data['卡图区域']) {
                            card.data['卡图区域'] = { imagePath: imgPath, scale: 1, x: 0, y: 0 };
                        } else {
                            card.data['卡图区域'].imagePath = imgPath;
                        }
                        continue;
                    }

                    // 3. 检查块模式开始 (例如 效果：{ )
                    const blockStartMatch = trimmedLine.match(/^(.+?)：\s*\{/);
                    if (blockStartMatch) {
                        currentBlockKey = blockStartMatch[1];
                        isJustStartedBlock = true;
                        continue;
                    }

                    // 4. 常规单行属性与卡图位置解析
                    const attrMatch = trimmedLine.match(/^(.+?)：(.*)$/);
                    if (attrMatch) {
                        const key = attrMatch[1];
                        const val = attrMatch[2];

                        if (key === '卡图位置') {
                            // 解析格式: "缩放 X Y" (例如: 100 66 11)
                            const parts = val.trim().split(/\s+/);
                            const s = parseFloat(parts[0]) / 100 || 1.0;
                            const x = parseFloat(parts[1]) || 0;
                            const y = parseFloat(parts[2]) || 0;

                            if (!card.data['卡图区域']) {
                                card.data['卡图区域'] = { imagePath: "", scale: s, x: x, y: y };
                            } else {
                                card.data['卡图区域'].scale = s;
                                card.data['卡图区域'].x = x;
                                card.data['卡图区域'].y = y;
                            }
                        } else {
                            // 普通属性（使用 label 作为 key）
                            card.data[key] = { text: val };
                        }
                        continue;
                    }
                }
                // 将解析完成的卡牌存入结果对象
                cardsObj[name] = card;
            });
        });
        return cardsObj;
    }

    bindObsidianFolder() {
        const chooser = document.createElement('input');
        chooser.type = 'file';
        chooser.setAttribute('nwdirectory', ''); // 唤起文件夹选择

        chooser.onchange = (e) => {
            const path = e.target.files[0].path;
            this.obsidianPath = path;

            // ★ 核心修复：将绑定的 Obsidian 路径存入当前选中的仓库配置中
            const ws = this.workspaces.find(w => w.id === this.currentWorkspace);
            if (ws) {
                ws.obsidianPath = path;
                this.storage.saveConfig({ workspaces: this.workspaces, currentWorkspace: this.currentWorkspace });
            }
            alert(`当前仓库已成功绑定 Obsidian 目录：\n${path}`);
        };
        chooser.click();
    }

    async syncAllFromObsidian() {
        if (!this.obsidianPath) {
            alert("请先绑定 Obsidian 目录！");
            return;
        }

        const fs = this.storage.fs;
        const path = this.storage.path;

        try {
            const files = fs.readdirSync(this.obsidianPath);
            const mdFiles = files.filter(f => f.endsWith('.md'));

            // 获取当前文件夹内所有合法的卡组名
            const currentMDDeckNames = mdFiles.map(f => f.replace(/\.md$/, ""));

            // --- 1. 处理“被物理删除的文件” ---
            // 如果程序里有的卡组在 Obsidian 目录里找不到了，直接物理抹除该卡组
            this.decks.forEach(deckName => {
                if (deckName !== '默认卡组' && !currentMDDeckNames.includes(deckName)) {
                    // 清理内存
                    for (const key in this.cardLibrary) {
                        if (this.cardLibrary[key].deck === deckName) delete this.cardLibrary[key];
                    }
                    // 清理硬盘 JSON 缓存
                    this.storage.deleteDeckFile(deckName);
                    console.log(`[Sync] 检测到 MD 文件已移除，清理卡组: ${deckName}`);
                }
            });

            let totalCards = 0;

            // --- 2. 遍历处理现有的 .md 文件 ---
            mdFiles.forEach(fileName => {
                const filePath = path.join(this.obsidianPath, fileName);
                const deckName = fileName.replace(/\.md$/, "");
                const content = fs.readFileSync(filePath, 'utf-8');

                // ★ 关键改进：在解析文件前，先清空内存库中【属于当前卡组】的所有卡
                // 这样解析出来的结果才是该文档的“纯净镜像”
                for (const key in this.cardLibrary) {
                    if (this.cardLibrary[key].deck === deckName) {
                        delete this.cardLibrary[key];
                    }
                }

                // 解析 MD 内容
                const newCards = this.parseMarkdownToCards(content, deckName, this.obsidianPath);

                // 将新卡合入内存大库
                Object.assign(this.cardLibrary, newCards);

                // 物理保存到对应的 JSON 文件（即使 newCards 是空的，也会刷掉旧的 JSON）
                this.storage.saveDeck(deckName, this.cardLibrary);

                totalCards += Object.keys(newCards).length;
            });

            // --- 3. 刷新全量 UI ---
            this.decks = this.extractDecks();
            this.updateDeckUI();
            this.updateCardSelectorUI();
            this.isDeckDirty = true;
            if (this.mode === 'deck') this.updateDeckGalleryUI();

            alert(`同步成功！\n当前库内共计 ${this.decks.length} 个卡组，${Object.keys(this.cardLibrary).length} 张卡牌。`);

        } catch (err) {
            console.error("同步失败:", err);
            alert("同步过程中出错，请检查目录权限。");
        }
    }
    async exportAllToObsidian() {
        if (!this.obsidianPath) {
            alert("未绑定目录，无法导出！");
            return;
        }

        const fs = this.storage.fs;
        const path = this.storage.path;

        // 1. 确保 Obsidian 目录下有 attachments 文件夹
        const obsAttachmentsDir = path.join(this.obsidianPath, 'attachments');
        try {
            if (!fs.existsSync(obsAttachmentsDir)) {
                fs.mkdirSync(obsAttachmentsDir, { recursive: true });
                console.log("[Sync] 已自动创建 Obsidian 附件目录");
            }
        } catch (e) {
            alert("无法创建附件目录，请检查权限。");
            return;
        }

        // 2. 按卡组对卡牌进行分组
        const deckGroups = {};
        Object.values(this.cardLibrary).forEach(card => {
            if (!deckGroups[card.deck]) deckGroups[card.deck] = [];
            deckGroups[card.deck].push(card);
        });

        try {
            for (const deckName in deckGroups) {
                let mdContent = "";
                const cards = deckGroups[deckName];

                // 按照模板分组，保持笔记整洁
                const templateGroups = {};
                cards.forEach(c => {
                    if (!templateGroups[c.templateName]) templateGroups[c.templateName] = [];
                    templateGroups[c.templateName].push(c);
                });

                for (const tplName in templateGroups) {
                    mdContent += `### @ ${tplName}\n\n`;

                    for (const card of templateGroups[tplName]) {
                        mdContent += `#### # ${card.name}\n`;

                        // --- ★ 核心改进：动态扫描所有图片层 ★ ---
                        for (const label in card.data) {
                            const slot = card.data[label];

                            if (slot && slot.imagePath) {
                                const originalPath = slot.imagePath;
                                const fileName = path.basename(originalPath);

                                // ★ 核心修复：使用 this.storage.basePath 替代 process.cwd()
                                const sourceFullPath = path.isAbsolute(originalPath)
                                    ? originalPath
                                    : path.join(this.storage.basePath, originalPath);

                                const targetFullPath = path.join(obsAttachmentsDir, fileName);

                                try {
                                    // 如果图片存在且附件库里还没有，就执行“物理搬家”
                                    if (fs.existsSync(sourceFullPath)) {
                                        fs.copyFileSync(sourceFullPath, targetFullPath);
                                        console.log(`[Sync] 图片已同步至 Obsidian: ${fileName}`);
                                    }
                                } catch (copyErr) {
                                    console.error(`[Sync] 图片迁移失败 (${fileName}):`, copyErr);
                                }

                                // 在 Markdown 中写入对应的引用链接
                                mdContent += `![[${fileName}]]\n`;

                                // 如果是坐标信息，一并写入
                                if (slot.scale !== undefined) {
                                    const s = Math.round((slot.scale || 1.0) * 100);
                                    const x = Math.round(slot.x || 0);
                                    const y = Math.round(slot.y || 0);
                                    mdContent += `${label}位置：${s} ${x} ${y}\n`;
                                }
                            }
                        }

                        // --- 属性处理 (文本层) ---
                        const tplDef = this.templateLibrary[card.templateName];
                        const elements = tplDef ? (Array.isArray(tplDef) ? tplDef : tplDef.elements) : [];

                        for (const label in card.data) {
                            // 排除已经处理过的图片层和卡名
                            if (card.data[label].imagePath || label === '卡名') continue;

                            const val = card.data[label].text || "";
                            const elDef = elements.find(e => e.label === label);

                            if ((elDef && elDef.multiline) || val.includes('\n')) {
                                mdContent += `${label}：{\n${val}\n}\n`;
                            } else {
                                mdContent += `${label}：${val}\n`;
                            }
                        }
                        mdContent += `\n---\n\n`;
                    }
                }

                const safeFileName = deckName.replace(/[\\\/:*?"<>|]/g, '_') + '.md';
                fs.writeFileSync(path.join(this.obsidianPath, safeFileName), mdContent, 'utf-8');
            }
            alert(`同步完成！\n所有卡组已更新，图片已存入 attachments 目录。`);
        } catch (err) {
            console.error("同步失败:", err);
            alert("导出失败，详细错误见控制台。");
        }
    }
}


const app = new CardForge();