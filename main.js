const { app, BrowserWindow, ipcMain } = require('electron');
const { chromium } = require('playwright');
const fs = require('fs').promises;

let mainWindow;
let recordedActions = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

async function injectListeners(page) {
  await page.evaluate(() => {
    function addListeners() {
      document.addEventListener('click', (e) => {
        const path = getElementPath(e.target);
        window.sendActionToMain(`await page.click('${path}');`);
      }, true);

      document.addEventListener('blur', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
          const path = getElementPath(e.target);
          window.sendActionToMain(`await page.fill('${path}', '${e.target.value}');`);
        }
      }, true);
    }

    function getElementPath(element) {
      if (!(element instanceof Element)) return;
      const path = [];
      while (element.nodeType === Node.ELEMENT_NODE) {
        let selector = element.nodeName.toLowerCase();
        if (element.id) {
          selector += '#' + element.id;
          path.unshift(selector);
          break;
        } else {
          let sib = element, nth = 1;
          while (sib = sib.previousElementSibling) {
            if (sib.nodeName.toLowerCase() == selector) nth++;
          }
          if (nth != 1) selector += `:nth-of-type(${nth})`;
        }
        path.unshift(selector);
        element = element.parentNode;
      }
      return path.join(' > ');
    }

    addListeners();

    // Re-add listeners after any dynamic page changes
    const observer = new MutationObserver((mutations) => {
      for (let mutation of mutations) {
        if (mutation.type === 'childList') {
          addListeners();
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

ipcMain.on('run-playwright', async (event, url) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsFilename = `record-${timestamp}.js`;
  const traceFilename = `trace-${timestamp}.zip`;

  let browser, context, page;
  try {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();

    // Start tracing
    await context.tracing.start({ screenshots: true, snapshots: true });

    // Clear previous recorded actions
    recordedActions = [];

    // Expose function to send actions to main process
    await page.exposeFunction('sendActionToMain', (action) => {
      recordedActions.push(action);
      event.reply('playwright-result', `Action recorded: ${action}`);
    });

    // Navigate to the URL
    await page.goto(url);
    recordedActions.push(`await page.goto('${url}');`);

    // Inject initial listeners
    await injectListeners(page);

    // Listen for navigation events
    page.on('load', async () => {
      await injectListeners(page);
      const currentUrl = page.url();
      recordedActions.push(`await page.goto('${currentUrl}');`);
      event.reply('playwright-result', `Navigated to: ${currentUrl}`);
    });

    event.reply('playwright-result', 'Browser opened. Perform your actions and close the browser when done.');

    // Wait for the page to be closed
    await page.waitForEvent('close', { timeout: 300000 });

    // Stop tracing and save
    await context.tracing.stop({ path: traceFilename });
    event.reply('playwright-result', `Trace saved to ${traceFilename}`);

    // Save recorded actions
    const script = `const { chromium } = require('playwright');\n\n(async () => {\n  const browser = await chromium.launch();\n  const page = await browser.newPage();\n\n  ${recordedActions.join('\n  ')}\n\n  await browser.close();\n})();`;
    await fs.writeFile(jsFilename, script);
    event.reply('playwright-result', `Recorded script saved to ${jsFilename}`);

    // Close the browser
    await browser.close();

  } catch (error) {
    event.reply('playwright-result', `Error: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    // Send a signal to re-enable the button
    event.reply('playwright-finished');
  }
});