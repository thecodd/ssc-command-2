// Shared form-field classes. Kept out of "use client" modules: a server component that imports a plain value from a client module
// receives a client reference (rendered as class="[object Object]"), not the string.
export const fieldCls = "min-h-[44px] w-full rounded-ctl border border-line bg-surface px-3 text-base outline-none focus:border-lime lg:text-sm";
