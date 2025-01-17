import { enrichHTML, getSetting, localize, templatePath } from '../module.js'
import { createSelfEffectMessage } from '../pf2e/item.js'
import { getActionIcon } from '../pf2e/misc.js'
import { toggleWeaponTrait } from '../pf2e/weapon.js'
import { popup, showItemSummary } from '../popup.js'
import { addNameTooltipListeners, filterIn, getItemFromEvent, localeCompare } from '../shared.js'
import { extrasUUIDS } from './extras.js'
import { skillActionsUUIDS } from './skills.js'

const SECTIONS_TYPES = {
    action: { order: 0, label: 'PF2E.ActionsActionsHeader', actionLabel: 'PF2E.ActionTypeAction' },
    reaction: { order: 1, label: 'PF2E.ActionTypeReaction', actionLabel: 'PF2E.ActionTypeReaction' },
    free: { order: 2, label: 'PF2E.ActionTypeFree', actionLabel: 'PF2E.ActionTypeFree' },
    passive: { order: 3, label: 'PF2E.ActionTypePassive', actionLabel: 'PF2E.ActionTypePassive' },
}

const TOOLTIPS = {
    delay: [500, 0],
    position: 'top',
    theme: 'crb-hover',
    arrow: false,
}

export async function getActionsData(actor, token, filter) {
    const isCharacter = actor.isOfType('character')
    const toggles = actor.synthetics.toggles.slice()
    const sorting = getSetting('actions')

    const stances = getStancesModuleApi()
        ?.getStances(actor)
        .sort((a, b) => localeCompare(a.name, b.name))

    let heroActions
    const heroActionsModule = game.modules.get('pf2e-hero-actions')
    if (heroActionsModule?.active && isCharacter) {
        const actions = heroActionsModule.api.getHeroActions(actor)
        const diff = actor.heroPoints.value - actions.length

        heroActions = {
            actions,
            draw: Math.max(diff, 0),
            discard: Math.abs(Math.min(diff, 0)),
            canTrade: actions.length && game.settings.get('pf2e-hero-actions', 'trade'),
        }
    }

    const isOwner = actor.isOwner
    const rollData = actor.getRollData()

    const strikes = actor.system.actions
        ? await Promise.all(
              actor.system.actions.map(async (strike, index) => ({
                  ...strike,
                  index,
                  visible: !isCharacter || strike.visible,
                  damageFormula: await strike.damage?.({ getFormula: true }),
                  criticalFormula: await strike.critical?.({ getFormula: true }),
                  description: strike.description
                      ? await enrichHTML(strike.description, actor, { rollData, isOwner })
                      : undefined,
                  altUsages:
                      strike.altUsages &&
                      (await Promise.all(
                          strike.altUsages.map(async altUsage => ({
                              ...altUsage,
                              usage: altUsage.item.isThrown ? 'thrown' : 'melee',
                              damageFormula: await altUsage.damage?.({ getFormula: true }),
                              criticalFormula: await altUsage.critical?.({ getFormula: true }),
                          }))
                      )),
              }))
          )
        : undefined

    const blast = isCharacter ? new game.pf2e.ElementalBlast(actor) : undefined
    const blasts = blast
        ? (
              await Promise.all(
                  blast.configs.map(async config => {
                      const damageType = config.damageTypes.find(damage => damage.selected)?.value ?? 'untyped'

                      const formulaFor = (outcome, melee = true) => {
                          return blast.damage({
                              element: config.element,
                              damageType,
                              melee,
                              outcome,
                              getFormula: true,
                          })
                      }

                      return {
                          ...config,
                          damageType,
                          formula: {
                              melee: {
                                  damage: await formulaFor('success'),
                                  critical: await formulaFor('criticalSuccess'),
                              },
                              ranged: {
                                  damage: await formulaFor('success', false),
                                  critical: await formulaFor('criticalSuccess', false),
                              },
                          },
                      }
                  })
              )
          ).sort((a, b) => localeCompare(a.label, b.label))
        : undefined

    let sections = {}

    const actions = isCharacter ? getCharacterActions(actor) : getNpcActions(actor)
    for (const action of actions) {
        if (!filterIn(action.name, filter)) continue
        if (sorting !== 'split') {
            sections.action ??= []
            sections.action.push(action)
        } else {
            sections[action.type] ??= []
            sections[action.type].push(action)
        }
    }

    sections = Object.entries(sections).map(([type, actions]) => {
        actions.forEach(action => {
            action.img = getActionIcon(action.cost)
            action.typeLabel = SECTIONS_TYPES[action.type].actionLabel
        })

        if (sorting !== 'type') {
            actions.sort((a, b) => localeCompare(a.name, b.name))
        } else {
            actions.sort((a, b) => {
                const orderA = SECTIONS_TYPES[a.type].order
                const orderB = SECTIONS_TYPES[b.type].order
                return orderA === orderB ? localeCompare(a.name, b.name) : orderA - orderB
            })
        }

        return { type, actions, label: SECTIONS_TYPES[type].label }
    })

    if (sorting === 'split') sections.sort((a, b) => SECTIONS_TYPES[a.type].order - SECTIONS_TYPES[b.type].order)

    if (
        toggles.length ||
        stances?.length ||
        strikes?.length ||
        blasts?.length ||
        sections.length ||
        heroActions?.actions.length
    ) {
        const nb =
            Number((stances?.length ?? 0) > 0) +
            Number((strikes?.length ?? 0) > 0) +
            Number((blasts?.length ?? 0) > 0) +
            sections.length +
            Number((heroActions?.actions.length ?? 0) > 0)

        return {
            contentData: {
                toggles,
                stances,
                strikes,
                blasts,
                sections,
                heroActions,
                i18n: str => localize(`actions.${str}`),
                variantLabel: label => label.replace(/.+\((.+)\)/, '$1'),
                damageTypes: CONFIG.PF2E.damageTypes,
            },
            doubled: nb > 1 && getSetting('actions-columns'),
            classes: [getSetting('actions-colors') ? 'attack-damage-system-colors' : ''],
        }
    }
}

export function addActionsListeners(el, actor) {
    addNameTooltipListeners(el.find('.toggle'))
    addNameTooltipListeners(el.find('.strike'))
    addNameTooltipListeners(el.find('.action'))

    function action(action, callback, type = 'click') {
        action = typeof action === 'string' ? [action] : action
        action = action.map(x => `[data-action=${x}]`).join(', ')
        return el.find(action).on(type, event => {
            event.preventDefault()
            callback(event)
        })
    }

    function getStrike(event) {
        const strikeEl = event.currentTarget.closest('.strike')
        const strike = actor.system.actions[strikeEl.dataset.index]
        if (!strike) return null

        const { altUsage } = event.currentTarget.dataset
        return ['melee', 'thrown'].includes(altUsage)
            ? strike.altUsages?.find(s => (altUsage === 'thrown' ? s.item.isThrown : s.item.isMelee)) ?? null
            : strike
    }

    function getUuid(event) {
        return $(event.currentTarget).closest('.action').data().uuid
    }

    action('action-description', async event => {
        const action = $(event.currentTarget).closest('.action')
        showItemSummary(action, actor)
    })

    action('hero-action-description', async event => {
        const { description, name } = (await getHeroActionDescription(getUuid(event))) ?? {}
        if (description) popup(name, description, actor)
    })

    action('strike-description', async event => {
        const strike = getStrike(event)
        if (!strike) return

        const description = document.createElement('div')
        description.classList.add('description')
        // this one is a copy of the system template, there is nothing to generate it
        description.innerHTML = await renderTemplate(templatePath('strike-description'), strike)

        popup(strike.label, description, actor)
    })

    action('blast-description', async event => {
        const blast = event.currentTarget.closest('.blast')
        showItemSummary($(blast), actor)
    })

    action('trait-description', event => {
        const strike = getStrike(event)
        if (!strike) return

        const { index } = event.currentTarget.dataset
        const trait = strike.traits[index]
        if (!trait) return

        const description = game.i18n.localize(trait.description)
        if (description) popup(game.i18n.localize(trait.label), description, actor)
    })

    action('stance-description', event => {
        const stance = $(event.currentTarget).closest('.action')
        showItemSummary(stance, actor)
    })

    // IS OWNER
    if (!actor.isOwner) return

    action('use-action', event => {
        const item = getItemFromEvent(event, actor)
        if (item?.isOfType('action', 'feat')) {
            createSelfEffectMessage(item)
        }
    })

    action('stance-chat', event => {
        const item = getItemFromEvent(event, actor)
        item?.toMessage(event, { create: true })
    })

    action('stance-toggle', event => {
        const { effectUuid } = event.currentTarget.closest('.action').dataset
        game.modules.get('pf2e-stances')?.api.toggleStance(actor, effectUuid)
    })

    action('action-chat', event => {
        const item = getItemFromEvent(event, actor)
        item?.toMessage(event, { create: true })
    })

    action('hero-action-chat', async event => {
        await game.modules.get('pf2e-hero-actions')?.api.sendActionToChat(actor, getUuid(event))
    })

    action('draw-hero-action', async event => {
        await game.modules.get('pf2e-hero-actions')?.api.drawHeroActions(actor)
    })

    action('use-hero-action', async event => {
        await game.modules.get('pf2e-hero-actions')?.api.useHeroAction(actor, getUuid(event))
    })

    action('discard-hero-action', async event => {
        await game.modules.get('pf2e-hero-actions')?.api.discardHeroActions(actor, getUuid(event))
    })

    action('trade-hero-action', async event => {
        game.modules.get('pf2e-hero-actions')?.api.tradeHeroAction(actor)
    })

    action('strike-attack', event => {
        const { index, altUsage } = event.currentTarget.dataset
        const strike = getStrike(event)
        strike?.variants[index].roll({ event, altUsage })
    })

    action(['strike-damage', 'strike-critical'], event => {
        const { action } = event.currentTarget.dataset
        const strike = getStrike(event)
        strike?.[action === 'strike-damage' ? 'damage' : 'critical']({ event })
    }).tooltipster(TOOLTIPS)

    action(['toggle-roll-option', 'set-suboption'], event => {
        const toggle = event.currentTarget.closest('.toggle')
        const { domain, option, itemId } = toggle.dataset
        const suboption = toggle.querySelector('select')?.value ?? null
        actor.toggleRollOption(domain, option, itemId ?? null, toggle.querySelector('input').checked, suboption)
    })

    action('strike-auxiliary', event => {
        if (event.currentTarget !== event.target) return

        const strike = getStrike(event)
        if (!strike) return

        const { index } = event.currentTarget.dataset
        const modular = event.currentTarget.querySelector('select')?.value ?? null

        strike.auxiliaryActions?.[index]?.execute({ selection: modular })
    })

    action('toggle-versatile', event => {
        const weapon = getStrike(event)?.item
        if (!weapon) return

        const target = event.currentTarget
        const { value } = target.dataset
        const baseType = weapon?.system.damage.damageType ?? null
        const selection = target.classList.contains('selected') || value === baseType ? null : value

        toggleWeaponTrait({ trait: 'versatile', weapon, selection })
    }).tooltipster(TOOLTIPS)

    action(
        'strike-ammo',
        async event => {
            const weapon = getStrike(event)?.item
            if (!weapon) return

            const ammo = actor.items.get(event.currentTarget.value)
            await weapon.update({ system: { selectedAmmoId: ammo?.id ?? null } })
        },
        'change'
    )

    if (!actor.isOfType('character')) return

    const selectors = ['roll-attack', 'roll-damage', 'set-damage-type'].map(s => `[data-action=${s}]`).join(',')
    el.find('.blast').each((_, blastEl) => {
        const { element, damageType } = blastEl.dataset
        const blast = new game.pf2e.ElementalBlast(actor)

        $(blastEl)
            .find(selectors)
            .on('click', async event => {
                event.preventDefault()

                const dataset = event.currentTarget.dataset
                const melee = dataset.melee === 'true'

                switch (dataset.action) {
                    case 'roll-attack': {
                        const mapIncreases = Math.clamped(Number(dataset.mapIncreases), 0, 2)
                        await blast.attack({ mapIncreases: Math.clamped(mapIncreases, 0, 2), element, damageType, melee, event })
                        break
                    }
                    case 'roll-damage': {
                        await blast.damage({ element, damageType, melee, outcome: dataset.outcome, event })
                        break
                    }
                    case 'set-damage-type': {
                        console.log(element, dataset.value)
                        await blast.setDamageType({ element, damageType: dataset.value })
                    }
                }
            })
    })
}

function getStancesModuleApi() {
    const module = game.modules.get('pf2e-stances')
    return module?.active ? module.api : undefined
}

function getHeroActionDescription(uuid) {
    return game.modules.get('pf2e-hero-actions')?.api.getHeroActionDetails(uuid)
}

function getCharacterActions(actor) {
    const stancesUUIDS = getStancesModuleApi()?.getActionsUUIDS() ?? new Set()
    const actionsUUIDS = new Set([...stancesUUIDS, ...skillActionsUUIDS, ...Object.values(extrasUUIDS)])
    const actions = actor.itemTypes.action.filter(item => !actionsUUIDS.has(item.sourceId))
    const feats = actor.itemTypes.feat.filter(item => item.actionCost && !stancesUUIDS.has(item.sourceId))

    return (
        [...actions, ...feats]
            // TODO maybe some day i will get back to this and give them their own place
            .filter(actions => {
                const traits = actions.system.traits.value
                return !traits.includes('downtime') && !traits.includes('exploration')
            })
            .map(action => {
                const actionCost = action.actionCost

                return {
                    id: action.id,
                    type: actionCost?.type ?? 'free',
                    cost: actionCost,
                    name: action.name,
                    hasEffect: !!action.system.selfEffect,
                }
            })
    )
}

function getNpcActions(actor) {
    return actor.itemTypes.action.map(item => {
        const actionCost = item.actionCost
        const actionType = actionCost?.type ?? 'passive'
        const hasAura =
            actionType === 'passive' &&
            (item.system.traits.value.includes('aura') || !!item.system.rules.find(r => r.key === 'Aura'))

        return {
            id: item.id,
            type: actionType,
            cost: actionCost,
            name: item.name,
            hasDeathNote: item.system.deathNote,
            hasAura,
            hasEffect: !!item.system.selfEffect,
        }
    })
}
