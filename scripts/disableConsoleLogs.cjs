const disabledValues = new Set(['1', 'true', 'yes', 'on']);
const isConsoleLogDisabled = disabledValues.has(
  String(process.env.DISABLE_CONSOLE_LOGS || '').toLowerCase()
);

if (isConsoleLogDisabled) {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}
