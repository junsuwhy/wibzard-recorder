const { ipcRenderer } = require('electron');

document.getElementById('runButton').addEventListener('click', () => {
    const url = document.getElementById('urlInput').value;
    if (url) {
        document.getElementById('result').innerText = 'Running Playwright...';
        ipcRenderer.send('run-playwright', url);
        document.getElementById('runButton').disabled = true;
    } else {
        document.getElementById('result').innerText = 'Please enter a URL';
    }
});

ipcRenderer.on('playwright-result', (event, result) => {
    const resultElement = document.getElementById('result');
    resultElement.innerText += result + '\n';
    resultElement.scrollTop = resultElement.scrollHeight;
});

ipcRenderer.on('playwright-finished', () => {
    document.getElementById('runButton').disabled = false;
});