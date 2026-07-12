export interface LoginItemApp {
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
  getLoginItemSettings(): { openAtLogin: boolean };
}

export function createStartAtLoginController(application: LoginItemApp) {
  return {
    enabled: () => application.getLoginItemSettings().openAtLogin,
    set: async (enabled: boolean) => {
      application.setLoginItemSettings({ openAtLogin: enabled });
    },
  };
}
