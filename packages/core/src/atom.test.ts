import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { mockFn } from '@reatom/internal-utils'

import {
  action,
  Atom,
  atom,
  AtomCache,
  AtomMeta,
  createContext,
  Ctx,
  Fn,
  isStale,
} from './atom'

// FIXME: get it from @reatom/utils
// (right now there is cyclic dependency, we should move tests to separate package probably)
{
  var onCleanup = (atom: Atom, cb: Fn<[Ctx]>) => {
    const hooks = (atom.__reatom.onCleanup ??= new Set())
    hooks.add(cb)
    return () => hooks.delete(cb)
  }
  var onConnect = (atom: Atom, cb: Fn<[Ctx]>) => {
    const hooks = (atom.__reatom.onConnect ??= new Set())
    hooks.add(cb)
    return () => hooks.delete(cb)
  }
  var onUpdate = (atom: Atom, cb: Fn<[Ctx, AtomCache]>) => {
    const hooks = (atom.__reatom.onUpdate ??= new Set())
    hooks.add(cb)
    return () => hooks.delete(cb)
  }
}

test(`action`, () => {
  const act1 = action()
  const act2 = action()
  const fn = mockFn()
  const a1 = atom(0)
  const a2 = atom((ctx) => {
    ctx.spy(a1)
    ctx.spy(act1).forEach(() => fn(1))
    ctx.spy(act2).forEach(() => fn(2))
  })
  const ctx = createContext()

  ctx.subscribe(a2, () => {})
  assert.is(fn.calls.length, 0)

  act1(ctx)
  assert.is(fn.calls.length, 1)

  act1(ctx)
  assert.is(fn.calls.length, 2)

  act2(ctx)
  assert.is(fn.calls.length, 3)
  assert.equal(
    fn.calls.map(({ i }) => i[0]),
    [1, 1, 2],
  )

  a1(ctx, (s) => s + 1)
  assert.is(fn.calls.length, 3)
  ;`👍` //?
})

test(`linking`, () => {
  const a1 = atom(0, `a1`)
  const a2 = atom((ctx) => ctx.spy(a1), `a2`)
  const context = createContext()
  const fn = mockFn()

  context.log((logs) => {
    logs.forEach((patch) =>
      assert.is.not(patch.cause, null, `"${patch.meta.name}" cause is null`),
    )
  })

  const un = context.subscribe(a2, fn)
  var a1Cache = context.read(a1.__reatom)!
  var a2Cache = context.read(a2.__reatom)!

  assert.is(fn.calls.length, 1)
  assert.is(fn.lastInput(), 0)
  assert.is(a2Cache.parents[0], a1Cache)
  assert.equal(a1Cache.children, new Set([a2.__reatom]))

  un()

  assert.is.not(a1Cache, context.read(a1.__reatom)!)
  assert.is.not(a2Cache, context.read(a2.__reatom)!)

  assert.is(context.read(a1.__reatom)!.children.size, 0)
  ;`👍` //?
})

test(`nested deps`, () => {
  const a1 = atom(0, `a1`)
  const a2 = atom((ctx) => ctx.spy(a1), `a2`)
  const a3 = atom((ctx) => ctx.spy(a1), `a3`)
  const a4 = atom((ctx) => ctx.spy(a2) + ctx.spy(a3), `a4`)
  const a5 = atom((ctx) => ctx.spy(a2) + ctx.spy(a3), `a5`)
  const a6 = atom((ctx) => ctx.spy(a4) + ctx.spy(a5), `a6`)
  const context = createContext()
  const fn = mockFn()
  const touchedAtoms: Array<AtomMeta> = []

  context.log((logs) => {
    logs.forEach((patch) =>
      assert.is.not(patch.cause, null, `"${patch.meta.name}" cause is null`),
    )
  })

  const un = context.subscribe(a6, fn)

  for (const a of [a1, a2, a3, a4, a5, a6]) {
    assert.is(
      isStale(context.read(a.__reatom)!),
      false,
      `"${a.__reatom.name}" should not be stale`,
    )
  }

  assert.is(fn.calls.length, 1)
  assert.equal(
    context.read(a1.__reatom)!.children,
    new Set([a2.__reatom, a3.__reatom]),
  )
  assert.equal(
    context.read(a2.__reatom)!.children,
    new Set([a4.__reatom, a5.__reatom]),
  )
  assert.equal(
    context.read(a3.__reatom)!.children,
    new Set([a4.__reatom, a5.__reatom]),
  )

  context.log((logs) => logs.forEach(({ meta }) => touchedAtoms.push(meta)))

  a1(context, 1)

  assert.is(fn.calls.length, 2)
  assert.is(touchedAtoms.length, new Set(touchedAtoms).size)

  un()

  for (const a of [a1, a2, a3, a4, a5, a6]) {
    assert.is(
      isStale(context.read(a.__reatom)!),
      true,
      `"${a.__reatom.name}" should be stale`,
    )
  }
  ;`👍` //?
})

test(`transaction batch`, () => {
  const track = mockFn()
  const pushNumber = action<number>()
  const numberAtom = atom((ctx) => {
    ctx.spy(pushNumber).forEach(track)
  })
  const context = createContext()
  context.subscribe(numberAtom, () => {})

  assert.is(track.calls.length, 0)

  pushNumber(context, 1)
  assert.is(track.calls.length, 1)
  assert.is(track.lastInput(), 1)

  context.run(() => {
    pushNumber(context, 2)
    assert.is(track.calls.length, 1)
    pushNumber(context, 3)
    assert.is(track.calls.length, 1)
  })
  assert.is(track.calls.length, 3)
  assert.is(track.lastInput(), 3)

  context.run(() => {
    pushNumber(context, 4)
    assert.is(track.calls.length, 3)
    context.get(numberAtom)
    assert.is(track.calls.length, 4)
    pushNumber(context, 5)
    assert.is(track.calls.length, 4)
  })
  assert.is(track.calls.length, 6)
  assert.is(track.lastInput(), 5)
  assert.equal(
    track.calls.map(({ i }) => i[0]),
    [1, 2, 3, 4, 4, 5],
  )
  ;`👍` //?
})

test(`late effects batch`, async () => {
  const a = atom(0)
  const context = createContext({
    // @ts-ignores
    callLateEffect: (cb, ...a) => setTimeout(() => cb(...a)),
  })
  const fn = mockFn()
  context.subscribe(a, fn)

  assert.is(fn.calls.length, 1)
  assert.is(fn.lastInput(), 0)

  a(context, (s) => s + 1)
  a(context, (s) => s + 1)
  await Promise.resolve()
  a(context, (s) => s + 1)

  assert.is(fn.calls.length, 1)

  await new Promise((r) => setTimeout(r))

  assert.is(fn.calls.length, 2)
  assert.is(fn.lastInput(), 3)
  ;`👍` //?
})

test(`display name`, () => {
  const firstNameAtom = atom(`John`, `firstName`)
  const lastNameAtom = atom(`Doe`, `lastName`)
  const isFirstNameShortAtom = atom(
    ({ spy }) => spy(firstNameAtom).length < 10,
    `isFirstNameShort`,
  )
  const fullNameAtom = atom(
    ({ spy }) => `${spy(firstNameAtom)} ${spy(lastNameAtom)}`,
    `fullName`,
  )
  const displayNameAtom = atom(
    ({ spy }) =>
      spy(isFirstNameShortAtom) ? spy(fullNameAtom) : spy(firstNameAtom),
    `displayName`,
  )
  const effect = mockFn()

  onConnect(fullNameAtom, () => effect(`fullNameAtom init`))
  onCleanup(fullNameAtom, () => effect(`fullNameAtom cleanup`))
  onConnect(displayNameAtom, () => effect(`displayNameAtom init`))
  onCleanup(displayNameAtom, () => effect(`displayNameAtom cleanup`))

  const ctx = createContext()

  const un = ctx.subscribe(displayNameAtom, () => {})

  assert.equal(
    effect.calls.map(({ i }) => i[0]),
    [`fullNameAtom init`, `displayNameAtom init`],
  )
  effect.calls = []

  firstNameAtom(ctx, `Joooooooooooohn`)
  assert.equal(
    effect.calls.map(({ i }) => i[0]),
    [`fullNameAtom cleanup`],
  )
  effect.calls = []

  firstNameAtom(ctx, `Jooohn`)
  assert.equal(
    effect.calls.map(({ i }) => i[0]),
    [`fullNameAtom init`],
  )
  effect.calls = []

  un()
  assert.equal(
    effect.calls.map(({ i }) => i[0]),
    [`displayNameAtom cleanup`, `fullNameAtom cleanup`],
  )
  ;`👍` //?
})

test.run()