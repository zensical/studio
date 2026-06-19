## complete

### accept_plain

``` md
`code`
```

### accept_empty

``` md
` `
```

### accept_with_brackets

``` md
`[code]`
```

### accept_empty_with_multiple_whitespace

``` md
`  `
```

## marker

### accept_2_backticks

``` md
``code``
```

### accept_3_backticks

``` md
```code```
```

### accept_nested_marker_as_text

``` md
`` `code` ``
```

### accept_shorter_marker_as_text

``` md
Text ``` code `` text ```
```

## text

### accept_leading_space

``` md
` code`
```

### accept_trailing_space

``` md
`code `
```

### accept_surrounding_space

``` md
` code `
```

### accept_tab

``` md
`	code	`
```

### accept_link_as_text

``` md
`[text](href)`
```

### accept_line_ending

``` md
`co
de`
```

## highlight

### accept_markdown

``` md
`:::md [text](href)`
```

### accept_markdown_shebang

``` md
`#!md [text](href)`
```

### accept_markdown_case_insensitive

``` md
`:::Markdown [text](href)`
```

### accept_missing_text_as_raw

``` md
`:::md`
```

### accept_2_colons_as_raw

``` md
`::md [text](href)`
```

### accept_leading_space_as_raw

``` md
` :::md [text](href) `
```

## position

### accept_before_text

``` md
`code` Text
```

### accept_after_text

``` md
Text `code`
```

### accept_multiple

``` md
`one` `two`
```

## attribute_list

### accept_plain

``` md
`code`{#id}
```

### accept_spaced

``` md
`code`{ #id .class key="value" }
```

## typeahead

### accept_open_marker

``` md
`
```

### accept_text

``` md
`code
```

### accept_markdown_marker

``` md
`:::
```

### accept_markdown_language

``` md
`:::md
```

### accept_markdown_text

``` md
`:::md [text](href)
```

## rejection

### reject_escaped_marker

``` md
Text \`code`
```
