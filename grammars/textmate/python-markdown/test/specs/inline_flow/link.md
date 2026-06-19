## complete

### accept_plain

``` md
[text](href)
```

### accept_empty

``` md
[]()
```

### accept_empty_text

``` md
[](href)
```

### accept_empty_href

``` md
[text]()
```

## text

### accept_leading_space

``` md
[ text](href)
```

### accept_trailing_space

``` md
[text ](href)
```

### accept_surrounding_space

``` md
[ text ](href)
```

### accept_escaped_opening_bracket

``` md
[text \[](href)
```

### accept_escaped_closing_bracket

``` md
[text \]](href)
```

### accept_escaped_brackets

``` md
[text \[\]](href)
```

### accept_nested_brackets

``` md
[[](#)](#)
```

### accept_code

``` md
[`code`](href)
```

## destination

### accept_parentheses

``` md
[text](href(foo))
```

### accept_nested_parentheses

``` md
[text](href(foo(bar)))
```

### accept_escaped_opening_paren

``` md
[text](href\()
```

### accept_escaped_closing_paren

``` md
[text](href\))
```

### accept_escaped_parentheses

``` md
[text](href\(foo\))
```

### accept_partial

``` md
[text](href
```

### accept_empty_partial

``` md
[text](
```

## title

### accept_double_quoted

``` md
[text](href "Title")
```

### accept_double_quoted_empty

``` md
[text](href "")
```

### accept_double_quoted_with_quotes

``` md
[text](href "A 'title'")
```

### accept_single_quoted

``` md
[text](href 'Title')
```

### accept_single_quoted_empty

``` md
[text](href '')
```

### accept_single_quoted_with_quotes

``` md
[text](href 'A "title"')
```

### accept_empty_href

``` md
[text]("Title")
[text]('Title')
```

### accept_empty_href_partial

``` md
[text]( "Title")
```

### accept_with_paren

``` md
[text](href "Tit)le")
```

### accept_partial

``` md
[text](href "
```

### accept_unterminated

``` md
[text](href "Title
```

## angle_destination

### accept_plain

``` md
[text](<href>)
```

### accept_empty

``` md
[text](<>)
```

### accept_parentheses

``` md
[text](<href(foo)>)
```

### accept_nested_parentheses

``` md
[text](<href(foo(bar))>)
```

### accept_partial

``` md
[text](<href
```

### accept_title_double_quoted

``` md
[text](<href> "Title")
```

### accept_title_single_quoted

``` md
[text](<href> 'Title')
```

### accept_title_partial

``` md
[text](<href> "
```

### accept_title_unterminated

``` md
[text](<href> "Title
```

### accept_title_unbalanced

``` md
[text](<href> "Title)
```

### accept_title_quote_partial

``` md
[text](<href> ")
```

## attribute_list

### accept_plain

``` md
[text](href){#id}
```

### accept_title

``` md
[text](href "Title"){#id}
```

### accept_spaced

``` md
[text](href){ #id .class }
```

## marker

### reject_escaped_opening_bracket

``` md
\[text](href)
```

### reject_escaped_closing_bracket

``` md
[text\](href)
```

## rejection

### reject_space_before_target

``` md
[text] (href)
```

### reject_line_ending_before_target

``` md
[text]
(href)
```
