// Minimal stand-in so this repo typechecks without the engine's real type package (owner has it in usage-esp).
declare module 'claude-code' { export type Register = (on: any, options: any) => void; export type EngineInterface = any; }
