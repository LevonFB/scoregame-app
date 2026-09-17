export { };

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: any;
        viewportHeight?: number;
        viewportStableHeight?: number;
        ready: () => void;
        expand: () => void;
        disableVerticalSwipes?: () => void;
        enableVerticalSwipes?: () => void;
        onEvent?: (eventType: string, callback: () => void) => void;
        offEvent?: (eventType: string, callback: () => void) => void;
        close: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        themeParams?: any;
        colorScheme?: "light" | "dark";
        HapticFeedback?: {
          impactOccurred: (style: string) => void;
          selectionChanged: () => void;
          notificationOccurred: (type: string) => void;
        };
        openLink?: (url: string) => void;
        openTelegramLink?: (url: string) => void;
        openInvoice?: (
          url: string,
          callback?: (status: "paid" | "cancelled" | "failed" | "pending" | string) => void
        ) => void;
        requestWriteAccess?: (callback?: (granted: boolean) => void) => void;
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
      };
    };
  }
}
