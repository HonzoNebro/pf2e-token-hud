import { HUD } from './hud.js'
import { getSetting, MODULE_ID } from './module.js'

let hud = null

function registerSetting(name, type, defValue, extra = {}) {
    game.settings.register(MODULE_ID, name, {
        ...extra,
        name: settingPath(name, 'name'),
        hint: settingPath(name, 'hint'),
        scope: 'client',
        config: true,
        type,
        default: defValue,
    })
}

Hooks.once('setup', () => {
    registerSetting('enabled', Boolean, true, { onChange: enableModule })

    registerSetting('position', String, 'right', {
        choices: {
            left: settingPath('position', 'choices.left'),
            right: settingPath('position', 'choices.right'),
            top: settingPath('position', 'choices.top'),
            bottom: settingPath('position', 'choices.bottom'),
        },
    })

    registerSetting('delay', Number, 250, {
        range: {
            min: 0,
            max: 2000,
            step: 50,
        },
    })

    registerSetting('scrollbar', Boolean, true)

    registerSetting('actions', String, 'split', {
        choices: {
            name: settingPath('actions', 'choices.name'),
            type: settingPath('actions', 'choices.type'),
            split: settingPath('actions', 'choices.split'),
        },
    })

    registerSetting('spells', Boolean, false)
})

Hooks.once('ready', () => {
    if (getSetting('enabled')) enableModule(true)
})

function settingPath(setting, key) {
    return `${MODULE_ID}.settings.${setting}.${key}`
}

function enableModule(enabled) {
    if (enabled && !hud) {
        hud = new HUD()

        Hooks.on('hoverToken', hud.hoverToken)
        Hooks.on('deleteToken', hud.deleteToken)
        Hooks.on('canvasPan', hud.forceClose)
    } else if (!enabled && hud) {
        Hooks.off('hoverToken', hud.hoverToken)
        Hooks.off('deleteToken', hud.deleteToken)
        Hooks.off('canvasPan', hud.forceClose)

        hud.delete()
        hud = null
    }
}