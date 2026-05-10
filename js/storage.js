class StorageAdapter {
    constructor() {
        this.mode = 'localstorage';
        this.fs = null;
        this.path = null;

        // 全局配置目录 (永远固定在程序运行目录，用来存仓库列表 config.json)
        this.globalDataDir = 'saved_data'; 
        this.configName = 'config.json';
        
        // 动态仓库目录 (随着点击上方仓库切换而改变)
        this.basePath = ""; 
        this.dataDir = 'saved_data'; 
        this.decksDir = 'decks';
        this.imgDir = 'images';
        
        this.fileMap = { 'cardForge_templates': 'templates.json', 'cardForge_cards': 'cards.json' };
    }

    async init() {
        const isNW = (typeof process !== 'undefined' && process.versions && process.versions.nw);
        if (isNW) {
            try {
                const req = (typeof nw !== 'undefined' && nw.require) ? nw.require : (window.require ? window.require : null);
                if (req) {
                    this.fs = req('fs');
                    this.path = req('path');
                    this.mode = 'filesystem';
                    
                    // 1. 初始化全局配置目录
                    this.globalDataDir = this.path.join(process.cwd(), 'saved_data');
                    if (!this.fs.existsSync(this.globalDataDir)) {
                        this.fs.mkdirSync(this.globalDataDir, { recursive: true });
                    }

                    // 2. 默认把仓库挂载到当前运行目录下
                    this.setRootPath(process.cwd()); 
                }
            } catch (e) { console.warn("FS Init Failed:", e); }
        }
        this._updateBadge();
    }

    // --- ★ 新增：动态切换仓库根目录 ★ ---
    setRootPath(newPath) {
        if (this.mode !== 'filesystem') return;
        
        // 更新基础路径
        this.basePath = newPath || process.cwd();
        
        // 更新所有的子路径指向新的仓库
        this.dataDir = this.path.join(this.basePath, 'saved_data');
        this.decksPath = this.path.join(this.dataDir, this.decksDir);
        this.imgDir = this.path.join(this.dataDir, 'images');

        // 确保新仓库的目录结构存在，不存在则自动创建
        if (!this.fs.existsSync(this.dataDir)) this.fs.mkdirSync(this.dataDir, { recursive: true });
        if (!this.fs.existsSync(this.decksPath)) this.fs.mkdirSync(this.decksPath, { recursive: true });
        if (!this.fs.existsSync(this.imgDir)) this.fs.mkdirSync(this.imgDir, { recursive: true });
        
        console.log(`[Storage] 物理存储路径已切换至: ${this.basePath}`);
    }

    getImgSource(relativePath) {
        if (this.mode !== 'filesystem' || !relativePath || relativePath.startsWith('http') || relativePath.startsWith('data:')) return relativePath;
        if (relativePath.includes(':') || relativePath.startsWith('/')) return 'file://' + relativePath.replace(/\\/g, '/');
        
        // ★ 修改：从当前的仓库路径 (basePath) 读取图片，而不是 cwd
        return 'file://' + this.path.join(this.basePath, relativePath).replace(/\\/g, '/');
    }

    async handleImageUpload(file) {
        if (this.mode === 'filesystem') {
            try {
                const ext = this.path.extname(file.path) || '.png';
                const newFileName = `img_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
                const destPath = this.path.join(this.imgDir, newFileName); // imgDir 已被 setRootPath 动态更新
                this.fs.writeFileSync(destPath, this.fs.readFileSync(file.path));
                return `saved_data/images/${newFileName}`; // 返回相对路径
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
            // ★ 修改：从当前的仓库路径 (basePath) 定位并删除图片
            const fullPath = this.path.join(this.basePath, relPath);
            if (this.fs.existsSync(fullPath)) this.fs.unlinkSync(fullPath);
        }
    }

    // ★ 修改：配置永远保存在程序的根目录 globalDataDir，确保仓库列表不会丢
    saveConfig(config) { 
        if (this.mode === 'filesystem') {
            this.fs.writeFileSync(this.path.join(this.globalDataDir, this.configName), JSON.stringify(config, null, 2)); 
        } 
    }
    
    loadConfig() {
        if (this.mode !== 'filesystem') return {};
        const p = this.path.join(this.globalDataDir, this.configName);
        return this.fs.existsSync(p) ? JSON.parse(this.fs.readFileSync(p, 'utf-8')) : {};
    }

// 在 StorageAdapter 类中替换这个方法
_updateBadge() {
    // 改为寻找我们新加的专属 ID
    const el = document.getElementById('modeBadge');
    if (el) {
        // 更新文字：极简显示
        el.innerText = this.mode === 'filesystem' ? '硬盘' : '网页';
        
        // 更新颜色：硬盘模式用蓝色，网页模式用橙色警告
        el.className = `text-[10px] px-1.5 py-0.5 rounded text-white shadow-sm flex-shrink-0 cursor-help ${
            this.mode === 'filesystem' ? 'bg-blue-600' : 'bg-orange-600'
        }`;
    }
}
}