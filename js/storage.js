class StorageAdapter {
    constructor() {
        this.mode = 'localstorage';
        this.fs = null;
        this.path = null;
        this.dataDir = 'saved_data';
        this.fileMap = { 'cardForge_templates': 'templates.json', 'cardForge_cards': 'cards.json' };
        this.decksDir = 'decks';
        this.configName = 'config.json';
    }

    async init() {
        const isNW = (typeof process !== 'undefined' && process.versions && process.versions.nw);
        if (isNW) {
            try {
                const req = (typeof nw !== 'undefined' && nw.require) ? nw.require :
                    (window.require ? window.require : null);
                if (req) {
                    this.fs = req('fs');
                    this.path = req('path');
                    this.dataDir = this.path.join(process.cwd(), 'saved_data');
                    if (!this.fs.existsSync(this.dataDir)) this.fs.mkdirSync(this.dataDir);
                    this.decksPath = this.path.join(this.dataDir, this.decksDir);
                    if (!this.fs.existsSync(this.decksPath)) this.fs.mkdirSync(this.decksPath);
                    this.imgDir = this.path.join(this.dataDir, 'images');
                    if (!this.fs.existsSync(this.imgDir)) this.fs.mkdirSync(this.imgDir);
                    this.mode = 'filesystem';
                }
            } catch (e) { console.warn("FS Init Failed:", e); }
        }
        this._updateBadge();
    }

    getImgSource(relativePath) {
        if (this.mode !== 'filesystem' || !relativePath || relativePath.startsWith('http') || relativePath.startsWith('data:')) return relativePath;
        if (relativePath.includes(':') || relativePath.startsWith('/')) return 'file://' + relativePath.replace(/\\/g, '/');
        return 'file://' + this.path.join(process.cwd(), relativePath).replace(/\\/g, '/');
    }

    async handleImageUpload(file) {
        if (this.mode === 'filesystem') {
            try {
                const ext = this.path.extname(file.path) || '.png';
                const newFileName = `img_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
                const destPath = this.path.join(this.imgDir, newFileName);
                this.fs.writeFileSync(destPath, this.fs.readFileSync(file.path));
                return `saved_data/images/${newFileName}`;
            } catch (err) { return null; }
        }
        return new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(file); });
    }

    load(key) {
        if (this.mode === 'filesystem') {
            if (key === 'cardForge_templates') {
                const filepath = this.path.join(this.dataDir, this.fileMap[key]);
                return this.fs.existsSync(filepath) ? JSON.parse(this.fs.readFileSync(filepath, 'utf-8')) : {};
            }
            if (key === 'cardForge_cards') {
                const allCards = {};
                if (this.fs.existsSync(this.decksPath)) {
                    this.fs.readdirSync(this.decksPath).forEach(file => {
                        if (file.endsWith('.json')) {
                            const content = JSON.parse(this.fs.readFileSync(this.path.join(this.decksPath, file), 'utf-8'));
                            Object.assign(allCards, content);
                        }
                    });
                }
                return allCards;
            }
        }
        return JSON.parse(localStorage.getItem(key) || '{}');
    }

    save(key, data) {
        if (this.mode === 'filesystem') {
            if (key === 'cardForge_templates') {
                this.fs.writeFileSync(this.path.join(this.dataDir, this.fileMap[key]), JSON.stringify(data, null, 2));
            } else if (key === 'cardForge_cards') {
                // 硬盘模式下，将全量数据拆分回各个卡组文件保存
                const decks = [...new Set(Object.values(data).map(c => c.deck || '默认卡组'))];
                decks.forEach(d => this.saveDeck(d, data));
            }
            return true;
        }
        localStorage.setItem(key, JSON.stringify(data));
        return true;
    }

    saveDeck(deckName, allCards) {
        if (this.mode !== 'filesystem') return this.save('cardForge_cards', allCards);
        const deckData = {};
        Object.values(allCards).forEach(card => { if (card.deck === deckName) deckData[card.name] = card; });
        const filepath = this.path.join(this.decksPath, (deckName || '默认卡组').replace(/[\\\/:*?"<>|]/g, '_') + '.json');
        this.fs.writeFileSync(filepath, JSON.stringify(deckData, null, 2));
        return true;
    }

    deleteDeckFile(deckName) {
        if (this.mode !== 'filesystem') return;
        const filepath = this.path.join(this.decksPath, (deckName || '默认卡组').replace(/[\\\/:*?"<>|]/g, '_') + '.json');
        if (this.fs.existsSync(filepath)) this.fs.unlinkSync(filepath);
    }

    deleteFile(relPath) {
        if (this.mode === 'filesystem' && relPath) {
            const fullPath = this.path.join(process.cwd(), relPath);
            if (this.fs.existsSync(fullPath)) this.fs.unlinkSync(fullPath);
        }
    }

    saveConfig(config) { if (this.mode === 'filesystem') this.fs.writeFileSync(this.path.join(this.dataDir, this.configName), JSON.stringify(config, null, 2)); }
    loadConfig() {
        if (this.mode !== 'filesystem') return {};
        const p = this.path.join(this.dataDir, this.configName);
        return this.fs.existsSync(p) ? JSON.parse(this.fs.readFileSync(p, 'utf-8')) : {};
    }

    _updateBadge() {
        const el = document.querySelector('h1 span');
        if (el) {
            el.innerText = this.mode === 'filesystem' ? '硬盘模式' : '网页模式';
            el.className = `text-xs px-1 rounded text-white ml-1 ${this.mode === 'filesystem' ? 'bg-blue-600' : 'bg-orange-600'}`;
        }
    }
}