import { useGlobLoader } from "./use-glob.js";


export const useCustomHandlers = useGlobLoader("src/**/*.handler.ts")