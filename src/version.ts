import {version as sourceVersion} from '../package.json';

export const version = import.meta.env.VITE_ZHIJUN_RELEASE_VERSION || sourceVersion;
