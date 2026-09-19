/**
 * Tailwind v4 needs no config file: the theme lives in the CSS entry that the
 * UI task creates. This file only registers the PostCSS plugin.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
