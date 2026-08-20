import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: "ai.beecode.desktop",
    executableName: "beecode",
    osxSign: {
      identity: "-",
      identityValidation: false,
    },
    protocols: [
      {
        name: "ai.beecode.desktop.oauth",
        schemes: ["ai.beecode.desktop"],
      },
    ],
  },
  makers: [new MakerZIP({}, ["darwin", "linux", "win32"])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/main.ts", config: "vite.main.config.mts", target: "main" },
        { entry: "src/preload/preload.ts", config: "vite.preload.config.mts", target: "preload" },
        { entry: "src/runtime/runtime.ts", config: "vite.runtime.config.mts", target: "main" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.mts" }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
