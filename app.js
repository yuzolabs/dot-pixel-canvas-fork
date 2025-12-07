let NG_WORDS = [];

// CSVファイルからNGワードを読み込む
async function loadNgWords() {
    try {
        const response = await fetch('./ng_words.csv');
        const csvText = await response.text();
        const lines = csvText.trim().split('\n');
        // 先頭行はヘッダ
        NG_WORDS = lines.slice(1).map(line => line.trim()).filter(Boolean);
    } catch (error) {
        console.warn('NGワードの読み込みに失敗しました', error);
        NG_WORDS = [];
    }
}

const grid = document.getElementById('canvas');
const colorDisplay = document.getElementById('currentColorDisplay');
const realPicker = document.getElementById('realColorPicker');
const albumList = document.getElementById('albumList');

const modal = document.getElementById('modal');
const closeModal = document.getElementById('closeModal');
const modalGrid = document.getElementById('modalGrid');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');

let currentSelectedColor = "#ffb7b2";
window.currentPixels = new Array(16).fill("#ffffff");

const STORAGE_KEY = 'pixel_diary_album';

const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
let hasNotifiedInvalidPixels = false;

// HTMLエスケープ（将来的に innerHTML を使用する変更が入っても安全側に倒すため明示的に用意）
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function notifyInvalidPixelData() {
    if (hasNotifiedInvalidPixels) return;
    hasNotifiedInvalidPixels = true;
    alert("ごめんね、絵のデータをうまく受け取れなかったみたい。\nもう一度ためしてみてね。");
}

function parseAndSanitizePixels(rawPixels) {
    let pixelsArray = rawPixels;

    if (typeof rawPixels === 'string') {
        try {
            pixelsArray = JSON.parse(rawPixels);
        } catch (e) {
            console.warn('Failed to parse pixel data JSON');
            return null;
        }
    }

    if (!Array.isArray(pixelsArray) || pixelsArray.length !== 16) {
        console.warn('Pixel data length is invalid', pixelsArray);
        return null;
    }

    return pixelsArray.map(color => {
        if (typeof color === 'string' && COLOR_REGEX.test(color)) {
            return color;
        }
        return '#cccccc';
    });
}

function savePostToStorage(postData) {
    let saved = localStorage.getItem(STORAGE_KEY);
    let posts = saved ? JSON.parse(saved) : [];
    posts.unshift(postData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
}

function removeFromStorage(targetPost) {
    let saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        let posts = JSON.parse(saved);
        posts = posts.filter(p => p.id !== targetPost.id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
    }
}

function resetCanvas() {
    window.currentPixels.fill("#ffffff");

    const pixels = document.querySelectorAll('.pixel');
    pixels.forEach(p => p.style.backgroundColor = "#ffffff");

    const titleInput = document.getElementById('titleInput');
    if (titleInput) titleInput.value = '';
}

function loadAlbumFromStorage() {
    let saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        let posts = JSON.parse(saved);
        posts.reverse().forEach(post => {
            window.addToAlbum(post, false);
        });
    }
}

function openModal(postData) {
    const dateObj = new Date(postData.created_at);
    const dateString = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getDate().toString().padStart(2, '0')}`;
    const pixelData = parseAndSanitizePixels(postData.pixels);
    if (!pixelData) {
        notifyInvalidPixelData();
        return;
    }

    modalTitle.textContent = escapeHtml(postData.title || '');
    modalDate.textContent = dateString;
    modalGrid.innerHTML = '';

    pixelData.forEach(colorValue => {
        const p = document.createElement('div');
        p.style.backgroundColor = (typeof colorValue === 'string') ? colorValue : '#cccccc';
        p.style.width = "100%"; p.style.height = "100%";
        modalGrid.appendChild(p);
    });
    modal.style.display = 'flex';
}

closeModal.addEventListener('click', () => { modal.style.display = 'none'; });
modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
});


realPicker.addEventListener('input', (e) => {
    currentSelectedColor = e.target.value;
    colorDisplay.style.backgroundColor = currentSelectedColor;
});

for (let i = 0; i < 16; i++) {
    const pixel = document.createElement('div');
    pixel.classList.add('pixel');
    pixel.dataset.index = i;
    pixel.addEventListener('click', function () {
        const index = this.dataset.index;
        window.currentPixels[index] = currentSelectedColor;
        this.style.backgroundColor = currentSelectedColor;
    });
    grid.appendChild(pixel);
}

window.addToAlbum = function (postData, shouldSave = true) {
    const dateObj = new Date(postData.created_at);
    const dateString = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getDate().toString().padStart(2, '0')}`;
    const pixelData = parseAndSanitizePixels(postData.pixels);
    if (!pixelData) {
        if (shouldSave) {
            notifyInvalidPixelData();
        } else {
            console.warn('Invalid pixel data found in saved album entry. Removing from storage.', postData);
            removeFromStorage(postData);
        }
        return;
    }

    if (shouldSave) {
        savePostToStorage({ ...postData, pixels: pixelData });
    }

    const itemDiv = document.createElement('div');

    itemDiv.classList.add('album-item');
    itemDiv.style.position = "relative";

    const delBtn = document.createElement('div');
    delBtn.textContent = "×";

    delBtn.style.position = "absolute";
    delBtn.style.top = "-15px";
    delBtn.style.right = "-15px";


    delBtn.style.width = "40px";
    delBtn.style.height = "40px";
    delBtn.style.lineHeight = "40px";
    delBtn.style.textAlign = "center";


    delBtn.style.color = "#888";
    delBtn.style.fontSize = "20px";
    delBtn.style.cursor = "pointer";
    delBtn.style.zIndex = "100";

    delBtn.style.opacity = "1";
    delBtn.style.visibility = "visible";

    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm("この絵をアルバムから削除しますか？")) {
            itemDiv.remove();
            removeFromStorage(postData);
        }
    });
    itemDiv.appendChild(delBtn);

    itemDiv.addEventListener('click', () => openModal(postData));

    const miniGridDiv = document.createElement('div');
    miniGridDiv.classList.add('mini-grid');

    pixelData.forEach(colorValue => {
        const p = document.createElement('div');
        p.classList.add('mini-pixel');
        p.style.backgroundColor = (typeof colorValue === 'string') ? colorValue : '#cccccc';
        miniGridDiv.appendChild(p);
    });

    const itemTitle = document.createElement('div');
    itemTitle.classList.add('item-title');
    itemTitle.textContent = escapeHtml(postData.title || '');
    const itemDate = document.createElement('div');
    itemDate.classList.add('item-date');
    itemDate.textContent = dateString;

    itemDiv.appendChild(miniGridDiv);
    itemDiv.appendChild(itemTitle);
    itemDiv.appendChild(itemDate);
    albumList.insertBefore(itemDiv, albumList.firstChild);
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadNgWords();
    loadAlbumFromStorage();
});

const WORKER_URL = 'https://dot-pixel-canvas-api.yuzorayu-cloudflare.workers.dev';

const exchangeBtn = document.getElementById('exchangeBtn');
const titleInput = document.getElementById('titleInput');

exchangeBtn.addEventListener('click', async function () {

    const isCanvasWhite = window.currentPixels.every(color => color === '#ffffff');

    const isTitleEmpty = !titleInput.value || titleInput.value.trim() === "";
    if (isCanvasWhite && isTitleEmpty) {
        alert("キャンバスが真っ白で、タイトルもありません\n絵を描くか、タイトルをつけてね。");
        return;
    }

    const titleText = titleInput.value || "むだい";

    // NGワードチェック
    if (typeof NG_WORDS !== 'undefined') {
        if (NG_WORDS.some(word => titleText.includes(word))) {
            alert("そのタイトルは使用できません。\n別のタイトルを入力してください。");
            return;
        }
    }

    exchangeBtn.disabled = true;
    exchangeBtn.textContent = "つうしんちゅう...";

    try {
        const response = await fetch(`${WORKER_URL}/exchange`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: titleText,
                pixels: window.currentPixels
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `通信エラー: ${response.status}`);
        }

        const resultPost = await response.json();

        if (resultPost) {
            window.addToAlbum(resultPost, true);
            alert("あなたの元に新しい絵がやってきました");
        } else {
            alert("投稿ありがとう！\n交換相手がいなかったので、あなたの絵は誰かが来るまで保管されます");
        }

        resetCanvas();

        titleInput.value = '';

    } catch (error) {
        console.error(error);

        if ((error.message || "").includes("Rate limit exceeded")) {
            alert("短い時間に投稿しすぎみたい。\n少し時間をおいてから、もういちど試してみてね。");
        } else {
            alert("エラー：" + error.message);
        }
    } finally {
        exchangeBtn.disabled = false;
        exchangeBtn.textContent = "こうかんする";
    }
});
