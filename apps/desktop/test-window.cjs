const { screen } = require('electron');

// Playwright runs open real windows: keep them silent and off the user's primary monitor.
module.exports = function configureTestWindows(app) {
  if (app.isPackaged || process.env.MATRO_TEST_WINDOW !== '1') return;
  app.commandLine.appendSwitch('mute-audio');
  app.on('browser-window-created', (_event, win) => {
    const primary = screen.getPrimaryDisplay();
    const display = screen.getAllDisplays().find(({ id }) => id !== primary.id);
    if (!display) return;
    const area = display.workArea, bounds = win.getBounds();
    const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
    win.setBounds({ x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), width, height });
  });
};
