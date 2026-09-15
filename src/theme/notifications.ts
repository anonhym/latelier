import { notifications } from '@mantine/notifications';

// Project-conventions wrapper around Mantine notifications. Callers stay
// explicit (per X12 resolved decision: no global auto-toast on IPC failures).
// Defaults: 4s auto-dismiss for info/success/warning, 6s for errors so the
// user has time to read details before they vanish.

interface NotifyOptions {
  title?: string;
  /** Auto-dismiss in ms. `false` keeps the toast open until dismissed. */
  autoClose?: number | false;
}

export const notify = {
  error(message: string, options: NotifyOptions = {}) {
    notifications.show({
      color: 'red',
      title: options.title ?? 'Error',
      message,
      autoClose: options.autoClose ?? 6000,
    });
  },
  success(message: string, options: NotifyOptions = {}) {
    notifications.show({
      color: 'green',
      title: options.title,
      message,
      autoClose: options.autoClose ?? 4000,
    });
  },
  info(message: string, options: NotifyOptions = {}) {
    notifications.show({
      color: 'blue',
      title: options.title,
      message,
      autoClose: options.autoClose ?? 4000,
    });
  },
  warning(message: string, options: NotifyOptions = {}) {
    notifications.show({
      color: 'orange',
      title: options.title ?? 'Warning',
      message,
      autoClose: options.autoClose ?? 4000,
    });
  },
};
