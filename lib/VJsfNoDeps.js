import copy from 'fast-copy'
import { deepEqual } from 'fast-equals'
import jrefs from './utils/json-refs'
import schemaUtils from './utils/schema'
import { defaultOptions, iconSets, localizedMessages, formats } from './utils/options'
import { getRules } from './utils/rules'
// import isCyclic from './utils/is-cyclic'
import ObjectContainer from './mixins/ObjectContainer'
import DateProperty from './mixins/DateProperty'
import SimpleProperty from './mixins/SimpleProperty'
import FileProperty from './mixins/FileProperty'
import ColorProperty from './mixins/ColorProperty'
import SelectProperty from './mixins/SelectProperty'
import EditableArray from './mixins/EditableArray'
import MarkdownEditor from './mixins/MarkdownEditor'
import Tooltip from './mixins/Tooltip'
import Validatable from './mixins/Validatable'
import Dependent from './mixins/Dependent'
import exprEvalParser from './utils/expr-eval-parser'
import expr from 'property-expr'
import debug from 'debug'

const debugExpr = debug('vjsf:expr')
debugExpr.log = console.log.bind(console)

const mountingIncs = {}

export default {
  name: 'VJsf',
  // components,
  mixins: [
    ObjectContainer,
    SimpleProperty,
    DateProperty,
    ColorProperty,
    SelectProperty,
    FileProperty,
    EditableArray,
    MarkdownEditor,
    Tooltip,
    Validatable,
    Dependent
  ],
  inject: ['theme'],
  props: {
    schema: { type: Object, required: true },
    value: { required: true },
    options: { type: Object },
    optionsRoot: { type: Object },
    modelRoot: { type: [Object, Array, String, Number, Boolean] },
    modelKey: { type: [String, Number], default: 'root' },
    parentKey: { type: String, default: '' },
    required: { type: Boolean, default: false },
    sectionDepth: { type: Number, default: 0 },
    sharedData: { type: Object, default: () => ({}) },
    showSectionTitle: { type: Boolean, default: false }
  },
  data() {
    return {
      loading: false,
      fullSchema: null
    }
  },
  computed: {
    initialOptions() {
      return this.fullKey === 'root' ? (this.options || {}) : this.optionsRoot
    },
    fullOptions() {
      const _global = (typeof window !== 'undefined' && window) || (typeof global !== 'undefined' && global) || {}
      defaultOptions.locale = (this.$vuetify.lang && this.$vuetify.lang.current) || 'en'
      defaultOptions.defaultLocale = (this.$vuetify.lang && this.$vuetify.lang.defaultLocale) || 'en'
      const fullOptions = Object.assign({}, defaultOptions, this.options || {}, this.resolvedSchema['x-options'] || {})

      fullOptions.markdown = fullOptions.markdown ||
        (_global.markdownit && (text => text ? _global.markdownit(fullOptions.markdownit).render(text) : '')) ||
        ((text) => text || '')
      fullOptions.memMarkdown = fullOptions.memMarkdown || (text => {
        this._vjsf_markdown = this._vjsf_markdown || {}
        const key = text + ''
        this._vjsf_markdown[key] = this._vjsf_markdown[key] || fullOptions.markdown(text)
        return this._vjsf_markdown[key]
      })

      fullOptions.httpLib = fullOptions.httpLib || this.axios || this.$http || this.$axios || _global.axios

      // validator function generator is either given or prepared using ajv if present in the context
      if (!fullOptions.validator) {
        const ajvLocalize = fullOptions.ajvLocalize || _global.ajvLocalize
        const ajvAddFormats = fullOptions.ajvAddFormats || _global.ajvAddFormats
        const localizeAjv = !!ajvLocalize && fullOptions.locale && ajvLocalize[fullOptions.locale]
        let ajv = fullOptions.ajv
        if (!ajv) {
          const Ajv = fullOptions.Ajv || _global.Ajv || (_global.ajv7 && _global.ajv7.default) || (_global.ajv2019 && _global.ajv2019.default)
          // TODO: use strict mode but remove our x-* annotations before
          if (Ajv) {
            ajv = new Ajv(localizeAjv ? { allErrors: true, messages: false, strict: false } : { strict: false })
            if (ajvAddFormats) ajvAddFormats(ajv)
            ajv.addFormat('hexcolor', /^#[0-9A-Fa-f]{6,8}$/)
          }
        }
        if (ajv) {
          fullOptions.validator = (schema) => {
            const validate = ajv.compile(schema)
            return (model) => {
              const valid = validate(model)
              if (!valid) {
                if (localizeAjv) {
                  ajvLocalize[fullOptions.locale](validate.errors)
                }
                return ajv.errorsText(validate.errors, { dataVar: '' })
              }
            }
          }
        }
      }
      fullOptions.iconfont = (this.$vuetify.icons && this.$vuetify.icons.iconfont) || 'mdi'
      // importing default icon fonts from vuetify
      if (!fullOptions.defaultIcons) {
        const vuetifyCustomIcons = {}
        for (const [key, value] of Object.entries(this.$vuetify.icons.values)) {
          vuetifyCustomIcons[key] = value.props ? value.props.name : value
        }
        fullOptions.defaultIcons = { ...iconSets[fullOptions.iconfont], ...vuetifyCustomIcons }
        fullOptions.icons = { ...fullOptions.defaultIcons, ...fullOptions.icons }
      }

      fullOptions.messages = { ...(localizedMessages[fullOptions.defaultLocale] || localizedMessages.en), ...(localizedMessages[fullOptions.locale] || localizedMessages.en), ...fullOptions.messages }
      fullOptions.formats = { ...formats, ...fullOptions.formats }
      if (fullOptions.deleteReadOnly) fullOptions.hideReadOnly = true
      return fullOptions
    },
    resolvedSchema() {
      if (this.modelKey === 'root') {
        const options = this.options || {}
        const locale = options.locale || options.defaultLocale || 'en'
        const defaultLocale = options.defaultLocale || 'en'
        return jrefs.resolve(
          this.schema,
          { '~$locale~': locale === defaultLocale ? locale : [locale, defaultLocale] }
        )
      } else {
        return this.schema
      }
    },
    htmlDescription() {
      return this.fullOptions.markdown(this.fullSchema && this.fullSchema.description)
    },
    fullKey() {
      return (this.parentKey + this.modelKey).replace('root.', '')
    },
    label() {
      if (!this.fullSchema) return
      if ((this.fullSchema.readOnly || this.fullOptions.readOnlyArrayItem) && this.fullOptions.hideReadOnlyLabels) return
      return this.fullSchema.title || (typeof this.modelKey === 'string' ? this.modelKey : '')
    },
    display() {
      if (!this.fullSchema) return
      return this.modelKey === 'root' && this.fullOptions.rootDisplay ? this.fullOptions.rootDisplay : this.fullSchema['x-display']
    },
    customTag() {
      if (!this.fullSchema) return
      return this.fullSchema['x-tag']
    },
    rules() {
      if (!this.fullSchema) return
      return getRules(this.schema, this.fullSchema, this.fullOptions, this.required, this.isOneOfSelect)
    },
    disabled() {
      if (!this.fullSchema) return
      return this.fullOptions.disableAll || this.fullSchema.readOnly
    },
    separator() {
      if (!this.fullSchema && this.fullSchema.type !== 'string') return
      return this.fullSchema.separator || this.fullSchema['x-separator']
    },
    slotName() {
      if (!this.fullSchema) return
      return this.fullSchema['x-display'] && this.fullSchema['x-display'].startsWith('custom-') ? this.fullSchema['x-display'] : this.fullKey
    },
    slotParams() {
      if (!this.fullSchema) return
      return {
        value: this.value,
        modelKey: this.modelKey,
        schema: this.schema,
        fullKey: this.fullKey,
        fullSchema: this.fullSchema,
        label: this.label,
        disabled: this.disabled,
        required: this.required,
        rules: this.rules,
        options: this.fullOptions,
        htmlDescription: this.htmlDescription,
        on: {
          input: (e) => this.input(e instanceof Event ? e.target.value : e),
          change: () => this.change()
        }
      }
    },
    dashKey() {
      return this.fullKey.replace(/\./g, '-')
    },
    // props common to many vuetify fields
    commonFieldProps() {
      if (!this.fullSchema) return
      const value = this.separator && typeof this.value === 'string' ? this.value.split(this.separator) : this.value
      return {
        value,
        inputValue: value,
        label: this.label,
        name: this.fullKey,
        id: this.fullOptions.idPrefix + this.dashKey,
        disabled: this.disabled,
        rules: this.rules,
        required: this.required,
        autofocus: this.fullOptions.autofocus,
        ...((this.fullSchema.readOnly || this.fullOptions.readOnlyArrayItem) ? this.fullOptions.readOnlyFieldProps : {}),
        ...this.fullOptions.fieldProps,
        ...this.fullSchema['x-props']
      }
    },
    propertyClass() {
      if (!this.fullSchema) return
      return `vjsf-property vjsf-property-${this.dashKey} pa-0 ${this.fullSchema['x-class'] || ''} ${(this.fullSchema.readOnly || this.fullOptions.readOnlyArrayItem) ? 'read-only' : ''}`
        .replace(/ {2}/g, ' ').trim()
    },
    xSlots() {
      if (!this.fullSchema) return
      return { ...this.fullSchema['x-slots'] }
    },
    formattedValue() {
      if (!this.fullSchema) return
      return this.value && this.fullSchema.format && this.fullOptions.formats[this.fullSchema.format] && this.fullOptions.formats[this.fullSchema.format](this.value, this.fullOptions.locale)
    },
    directives() {
      if (!this.fullSchema) return
      return this.fullSchema['x-directives']
    }
  },
  watch: {
    fullSchema: {
      handler() {
        if (!this.fullSchema) return
        this.initFromSchema()
        this.initValidation()
        this.updateSelectItems()
      }
    }
  },
  mounted() {
    mountingIncs[this.fullKey] = (mountingIncs[this.fullKey] || 0) + 1
    // DEVS NOTE: uncomment this when fighting against infinite loops
    // if infinite loop occurs again have a look here https://github.com/koumoul-dev/vuetify-jsonschema-form/issues/289
    // and here https://github.com/koumoul-dev/vuetify-jsonschema-form/commit/fba002dea2438f5ea2ff5be1622ac79b35056eff
    /* if (mountingIncs[this.fullKey] === 100) {
      console.log(mountingIncs)
      throw new Error('detected infinite mounting loop: ' + this.fullKey)
    } */

    // optimize the watcher used to reprocess fullSchema so that we trigger less re-render of components
    let watcher = 'resolvedSchema'
    if (this.resolvedSchema.dependencies || this.resolvedSchema.if) {
      watcher = (vm) => [vm.resolvedSchema, vm.value]
    }
    this.$watch(watcher, () => {
      const fullSchema = schemaUtils.prepareFullSchema(this.resolvedSchema, this.value, this.fullOptions)
      // kinda hackish but prevents triggering large rendering chains when nothing meaningful changes
      if (!deepEqual(fullSchema, this.fullSchema)) this.fullSchema = fullSchema
    }, {
      immediate: true,
      deep: true
    })
  },
  render(h) {
    this.renderInc = (this.renderInc || 0) + 1
    // DEVS NOTE: uncomment this when fighting against infinite loops
    /* if (this.renderInc === 100) {
      throw new Error('detected infinite rendering loop: ' + this.fullKey)
    } */

    // a few cases where we don't render anything
    if (!this.fullSchema) return
    if (this.fullSchema.const !== undefined) return
    if (this.display === 'hidden') return
    if (this.fullSchema.readOnly && this.fullOptions.hideReadOnly) return
    if (this.fullOptions.readOnlyArrayItem && this.fullOptions.hideInArrayItem) return
    if ((this.fullSchema.readOnly || this.fullOptions.readOnlyArrayItem) && this.fullOptions.hideReadOnlyEmpty && [null, undefined, ''].includes(this.value)) return
    if (this.fullSchema['x-if'] && !this.getFromExpr(this.fullSchema['x-if'])) return

    const children = []
    if (this.$scopedSlots.before) children.push(this.$scopedSlots.before(this.slotParams))
    else if (this.$slots.before) this.$slots.before.forEach(node => children.push(node))
    else if (this.xSlots.before) children.push(h('div', { domProps: { innerHTML: this.fullOptions.memMarkdown(this.xSlots.before) } }))

    if (this.$scopedSlots.default) {
      children.push(this.$scopedSlots.default(this.slotParams))
    } else if (this.fullSchema['x-display'] && this.fullSchema['x-display'] && this.$scopedSlots[this.fullSchema['x-display']]) {
      children.push(this.$scopedSlots[this.fullSchema['x-display']](this.slotParams))
    } else {
      const mainChildren = this.renderDateProp(h) ||
        this.renderColorProp(h) ||
        this.renderSelectProp(h) ||
        this.renderFileProp(h) ||
        this.renderMarkdownProp(h) ||
        this.renderSimpleProp(h) ||
        this.renderObjectContainer(h) ||
        this.renderEditableArray(h) || []
      mainChildren.forEach(child => children.push(child))
    }

    if (this.$scopedSlots.after) children.push(this.$scopedSlots.after(this.slotParams))
    else if (this.$slots.after) this.$slots.after.forEach(node => children.push(node))
    else if (this.xSlots.after) {
      children.push(h('div', { domProps: { innerHTML: this.fullOptions.memMarkdown(this.xSlots.after) } }))
    }

    let colProps = { ...this.fullOptions.fieldColProps }
    if (this.fullSchema['x-cols']) {
      if (typeof this.fullSchema['x-cols'] === 'object') {
        colProps = { ...colProps, ...this.fullSchema['x-cols'] }
      } else {
        colProps.cols = this.fullSchema['x-cols']
      }
    }
    return h('v-col', { props: colProps, class: this.propertyClass, style: this.fullSchema['x-style'] || '' }, children)
  },
  methods: {
    cached(key, params, fn) {
      this._vjsf_cache = this._vjsf_cache || {}
      if (!this._vjsf_cache[key] || !deepEqual(this._vjsf_cache[key].params, params)) {
        // console.log('fill cache', key, this.fullKey)
        this._vjsf_cache[key] = { params: copy(params), value: fn() }
      } else {
        // console.log('use cache', key, this.fullKey)
      }
      return this._vjsf_cache[key].value
    },
    // used by all functionalities that require looking into the data or the context (x-if, fromData, etc)
    getFromExpr(exp) {
      const expData = this.getExprNode()
      expData.modelRoot = this.modelRoot
      expData.root = this.modelRoot
      expData.model = this.value
      expData.context = this.options.context

      this._vjsf_getters = this._vjsf_getters || {}

      // newFunction can only be defined on main options (not x-options to prevent injection)
      if (this.initialOptions.evalMethod === 'newFunction') {
        debugExpr(`evaluate expression "${exp}" with newFunction method`, expData)
        // use a powerful meta-programming approach with "new Function", not safe if the schema is user-submitted
        // eslint-disable-next-line no-new-func
        this._vjsf_getters[exp] = this._vjsf_getters[exp] || new Function(...Object.keys(expData), `return ${exp}`)
        const result = this._vjsf_getters[exp](...Object.values(expData))
        debugExpr(`result`, result)
        return result
      } else if (this.fullOptions.evalMethod === 'evalExpr') {
        debugExpr(`evaluate expression "${exp}" with exprEval method`, expData)
        // TODO: conserve compiled expression for reuse ?
        const result = exprEvalParser.evaluate(exp, expData)
        debugExpr(result)
        return result
      } else {
        exp = this.prefixExpr(exp)
        debugExpr(`evaluate expression "${exp}" with propertyExpr method`, expData)
        // otherwise a safer but not as powerful deep getter method
        this._vjsf_getters[exp] = this._vjsf_getters[exp] || expr.getter(exp, true)
        const result = this._vjsf_getters[exp](expData)
        debugExpr(`result`, result)
        return result
      }
    },
    // used by getFromExpr to support simpler expressions that look into the root model by default
    prefixExpr(key) {
      if (key.startsWith('context.') || key.startsWith('model.') || key.startsWith('value.') || key.startsWith('modelRoot.') || key.startsWith('root.') || key.startsWith('parent.')) return key
      // no specific prefix found, we use modelRoot for retro-compatibility
      if (this.modelRoot) return 'root.' + key
      return 'model.' + key
    },
    renderPropSlots(h) {
      const slots = []
      Object.keys(this.xSlots).forEach(slot => {
        slots.push(h('div', { slot, domProps: { innerHTML: this.fullOptions.memMarkdown(this.xSlots[slot]) } }))
      })
      Object.keys(this.$slots).forEach(slot => {
        slots.push(h('template', { slot }, this.$slots[slot]))
      })
      return slots
    },
    async change(fastForward = true) {
      if (!this.changed) return
      // let input events be interpreted before sending this.value in change event
      await this.$nextTick()

      // store all current promises in sharedData.asyncOperations so that we can delay change events
      // until after a user interaction has finished having async consequencies
      this.sharedData.asyncOperations = this.sharedData.asyncOperations || {}
      while (Object.keys(this.sharedData.asyncOperations).length) {
        for (const key in this.sharedData.asyncOperations) {
          await this.sharedData.asyncOperations[key]
        }
        await this.$nextTick()
      }
      this.updateSelectItems()
      if (fastForward) this.fastForwardEvent('change-child', { fullKey: this.fullKey, value: this.value })
      this.$emit('change', this.value)
      this.changed = false
    },
    input(value, initial = false, fastForward = true) {
      if (Array.isArray(value) && this.separator) value = value.join(this.separator)
      if (value === null || value === undefined) {
        if (this.fullSchema.nullable) {
          if (this.value !== null) {
            this.changed = true
            if (fastForward) this.fastForwardEvent('input-child', { fullKey: this.fullKey, value: null, oldValue: this.value })
            this.$emit('input', null)
          } else if (initial) {
            if (fastForward) this.fastForwardEvent('input-child', { fullKey: this.fullKey, value: null, oldValue: this.value })
            this.$emit('input', null)
          }
        } else {
          if (this.value !== undefined) {
            this.changed = true
            if (fastForward) this.fastForwardEvent('input-child', { fullKey: this.fullKey, value: undefined, oldValue: this.value })
            this.$emit('input', undefined)
          }
        }
      } else {
        if (!deepEqual(value, this.value)) {
          this.changed = true
          // console.log(this.fullKey, isCyclic(value), value)
          if (fastForward) this.fastForwardEvent('input-child', { fullKey: this.fullKey, value, oldValue: this.value })
          this.$emit('input', value)
        }
      }
    },
    fixValueType(value, schema) {
      if ([null, undefined].includes(value)) return value
      if (schema.type === 'string' && typeof value !== 'string') return undefined
      if (schema.type === 'integer' && typeof value !== 'number') return undefined
      if (schema.type === 'number' && typeof value !== 'number') return undefined
      if (schema.type === 'boolean' && typeof value !== 'boolean') return undefined
      if (schema.type === 'array' && !Array.isArray(value)) return undefined
      if (schema.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) return undefined
      return value
    },
    defaultValue(schema) {
      if (schema.readOnly && this.fullOptions.deleteReadOnly) return undefined
      if (schema.type === 'object' && !schema['x-fromUrl'] && !schema['x-fromData'] && !schema.enum) return {}
      if (schema.type === 'array') return []
      return null
    },
    fixProperties(value) {
      if (this.fullSchema.type !== 'object' || !value) return value

      const nonSchematized = (!this.fullSchema.properties || !this.fullSchema.properties.length) && (!Object.keys(this.subModels).length || !!this.fullSchema['x-fromData'] || !!this.fullSchema['x-fromUrl'])
      if (nonSchematized) return value

      value = { ...value }

      // cleanup extra properties
      if (this.fullOptions.removeAdditionalProperties || this.fullSchema.additionalProperties === false) {
        Object.keys(value).forEach(key => {
          if (!(this.fullSchema.properties || []).find(p => p.key === key)) {
            // console.log(`Remove key ${this.modelKey}.${key}`)
            delete value[key]
          }
        })
      }

      // apply submodels
      Object.keys(this.subModels).forEach(subModel => {
        Object.keys(this.subModels[subModel]).forEach(key => {
          // special case, ignore subschema switch key coming from another submodel
          const localProperty = this.fullSchema.properties.find(p => p.key === key)
          if (localProperty && localProperty.const) return

          if (value[key] === this.subModels[subModel][key]) return
          value[key] = this.subModels[subModel][key]
        })
      })
      return value
    },
    initFromSchema() {
      // initiallyDefined will by used in Validatable.js to perform initial validation or not
      this.initiallyDefined = this.value !== undefined && this.value !== null
      // we cannot consider empty objects and empty arrays as "defined" as they might have been initialized by vjsf itself
      if (this.fullSchema.type === 'array') this.initiallyDefined = !!(this.value && this.value.length)
      if (this.fullSchema.type === 'object') this.initiallyDefined = !!(this.value && Object.keys(this.value).length)

      // console.log('Init from schema', this.modelKey)
      if (this.fullSchema.readOnly && this.fullOptions.deleteReadOnly) {
        return this.input(undefined)
      }
      let value = this.value

      // create empty objects
      if (this.fullSchema.type === 'object' && [undefined, null].includes(value) && !this.isSelectProp) {
        value = {}
      }
      // in the special case of objects based on select remove empty objects
      if (this.fullSchema.type === 'object' && this.isSelectProp && value && Object.keys(value).length === 0) {
        value = undefined
      }

      // const always wins
      if (this.fullSchema.const !== undefined) value = this.fullSchema.const
      this.initSelectProp(value)
      this.initObjectContainer(value)
      // Cleanup arrays of empty items
      if (this.fullSchema.type === 'array') {
        value = this.value.filter(item => ![undefined, null].includes(item))
      }
      return this.input(this.fixProperties(value), true)
    }
  }
}
