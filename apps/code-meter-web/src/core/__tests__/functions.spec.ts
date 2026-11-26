import { describe, expect, it } from 'vitest'
import { countFunctions, FUNCTION_RULE_VERSION } from '../functions'

describe('function definition counting', () => {
  it('measures the Java sample body as one effective code line', () => {
    expect(
      countFunctions('class A { int add(int a,int b){return a+b;} }', 'java', ['code']),
    ).toEqual({ count: 1, sizes: [1], incomplete: false })
  })

  it('excludes abstract methods without bodies', () => {
    expect(countFunctions('abstract class B { abstract void f(); void g(){} }', 'java').count).toBe(
      1,
    )
  })

  it('excludes C declarations, calls and macro definitions', () => {
    expect(
      countFunctions('#define F(x) (x)\nvoid declared();\nint f(){ declared(); return F(1); }', 'c')
        .count,
    ).toBe(1)
  })
  it('uses the new rule version', () => {
    expect(FUNCTION_RULE_VERSION).toBe('function-definitions-2.0')
  })

  it.each([
    ['free function', 'int f(){return 1;}', 1],
    ['class method', 'class A { public: void g(){} };', 1],
    ['constructor and destructor', 'class A { public: A(){} ~A(){} };', 2],
    ['operator overload', 'struct V { V operator+(const V& o){ return o; } };', 1],
    ['out-of-class definition', 'void A::g(){}', 1],
  ])('counts C++ %s', (_label, text, expected) => {
    expect(countFunctions(text, 'cpp').count).toBe(expected)
  })

  it('does not count C++ lambda expressions', () => {
    expect(countFunctions('[](){ };', 'cpp').count).toBe(0)
    expect(countFunctions('auto f = [](int x){ return x; };', 'cpp').count).toBe(0)
  })

  it('counts Python named functions but not lambdas', () => {
    expect(countFunctions('f = lambda x: x\ndef g(x):\n    return f(x)', 'python').count).toBe(1)
  })

  it.each([
    ['interface default method', 'interface I { void f(); default void g(){ } }', 1],
    ['constructors', 'class A { A(){ } A(int x){ this(); } }', 2],
    ['lambdas', 'class A { void f(){ xs.forEach(x -> a(x)); Runnable r = () -> {}; } }', 1],
    [
      'anonymous class method',
      'class A { Runnable r = new Runnable(){ public void run(){ int y=1; } }; }',
      1,
    ],
    ['record method', 'record Point(int x,int y){ int sum(){ return x+y; } }', 1],
  ])('counts Java %s independently', (_label, text, count) => {
    expect(countFunctions(text, 'java').count).toBe(count)
  })

  it('counts definitions despite Java nested generic parser errors', () => {
    const result = countFunctions(
      'class A { Map<String,List<Integer>> f; void a(){} void b(){} void c(){} }',
      'java',
    )
    expect(result.count).toBe(3)
    expect(result.incomplete).toBe(true)
    expect(result.warning).toContain('解析存在 2 处未识别内容')
  })

  it('returns zeroes for an empty file and counts known definitions in truncated input', () => {
    expect(countFunctions('', 'c')).toMatchObject({
      count: 0,
      sizes: [],
      incomplete: false,
    })
    const truncated = countFunctions('int f() { return "unfinished; }', 'c')
    expect(truncated.count).toBe(1)
    expect(truncated.incomplete).toBe(true)
  })

  it('returns no function result for unsupported languages', () => {
    expect(countFunctions('function f() {}', 'javascript')).toEqual({
      count: 0,
      sizes: [],
      incomplete: false,
    })
  })
  it('counts effective code lines inside each function body', () => {
    const result = countFunctions('void f() {\n int x = 1; // mixed\n // comment\n\n}', 'cpp', [
      'code',
      'code',
      'comment',
      'blank',
      'code',
    ])
    expect(result.sizes).toEqual([3])
  })
})
