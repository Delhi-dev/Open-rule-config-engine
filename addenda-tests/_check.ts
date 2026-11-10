// Tiny assertion helper shared by the AD-3 checks (run with: npx tsx addenda-tests/<file>).
export function checker(file: string) {
  let fails = 0, passes = 0;
  const show = (v: unknown) => (v === undefined ? 'undefined' : JSON.stringify(v));
  const report = (ok: boolean, name: string, detail: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}: ${name}${ok ? '' : ' — ' + detail}`);
    ok ? passes++ : fails++;
  };
  return {
    eq(name: string, thunk: () => unknown, want: unknown) {
      try {
        const got = thunk();
        report(show(got) === show(want), name, `expected ${show(want)}, got ${show(got)}`);
      } catch (e) {
        report(false, name, `expected ${show(want)}, but it threw: ${(e as Error).message}`);
      }
    },
    throws(name: string, thunk: () => unknown, re: RegExp) {
      try {
        const got = thunk();
        report(false, name, `expected an error matching ${re}, got ${show(got)}`);
      } catch (e) {
        const m = (e as Error).message;
        report(re.test(m), name, `expected an error matching ${re}, got: ${m}`);
      }
    },
    done() {
      console.log(fails ? `\n${fails} ${file} check(s) failed, ${passes} passed` : `\nAll ${passes} ${file} checks passed`);
      process.exit(fails ? 1 : 0);
    },
  };
}
