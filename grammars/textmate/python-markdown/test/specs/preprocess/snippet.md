## inline

### accept_double_quoted

``` md
--8<-- "index.md"
```

### accept_single_quoted

``` md
---8<--- 'index.md'
```

### accept_indented

``` md
    --8<-- "index.md"
```

### accept_section_selector

``` md
--8<-- "index.md:example"
```

### accept_line_selector

``` md
--8<-- "index.md:1:3,5:7"
```

### reject_escaped

``` md
;--8<-- "index.md"
```

### reject_unquoted

``` md
--8<-- index.md
```

### reject_trailing_space

``` md
--8<-- "index.md" 
```

## block

### accept_plain

``` md
--8<--
index.md
about.md
--8<--
```

### accept_blank_lines

``` md
--8<--

  
index.md
--8<--
```

### accept_selectors

``` md
--8<--
index.md:1:3
about.md:section
https://example.com/
--8<--
```

### accept_line_selector_split

``` md
--8<--
snippet.md:1:3
--8<--
```

### accept_indented

``` md
 --8<--
   index.md  
 --8<--
```

### accept_comment_line

``` md
--8<--
; comment
index.md
--8<--
```

## section

### accept_start

``` md
--8<-- [start:example]
```

### accept_end

``` md
--8<-- [end:example]
```

### accept_with_prefix_and_suffix

``` md
prefix --8<-- [start:example] suffix
```

### accept_uppercase_keyword

``` md
--8<-- [START:example]
```

### reject_escaped

``` md
;--8<-- [start:example]
```
