import en from '../../public/locales/en/translation.json';

export const buildApplicationMenuLabels = (translate) => Object.fromEntries(
  Object.entries(en.menu).map(([key, defaultValue]) => [
    key, translate(`menu.${key}`, { defaultValue }),
  ]),
);
