// A minimal window.Telegram.WebApp stub injected before app scripts run.
// Provides the methods/fields web/app/page.tsx reads during bootstrap.
export const telegramInitScript = `
(() => {
  const noop = () => {};
  const initData = "user=%7B%22id%22%3A777777%2C%22first_name%22%3A%22E2E%22%7D&auth_date=1750000000&hash=deadbeef";
  window.Telegram = {
    WebApp: {
      initData,
      initDataUnsafe: { user: { id: 777777, first_name: "E2E" }, start_param: "" },
      themeParams: { secondary_bg_color: "#f2f2f7" },
      viewportHeight: 800,
      viewportStableHeight: 800,
      ready: noop,
      expand: noop,
      disableVerticalSwipes: noop,
      enableVerticalSwipes: noop,
      onEvent: noop,
      offEvent: noop,
      setHeaderColor: noop,
      setBackgroundColor: noop,
      openTelegramLink: noop,
      openLink: noop,
      requestWriteAccess: (cb) => cb && cb(true),
      HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
      MainButton: { show: noop, hide: noop, setText: noop, onClick: noop, offClick: noop },
      BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
      close: noop,
    },
  };
})();
`;
