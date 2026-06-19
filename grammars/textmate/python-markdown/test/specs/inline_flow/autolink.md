## scheme

### accept_scheme_http

``` md
<http://example.com>
```

### accept_scheme_https

``` md
<https://example.com>
```

### accept_scheme_uppercase

``` md
<HTTP://example.com>
```

### accept_scheme_ftp

``` md
<ftp://example.com>
```

### accept_query

``` md
<https://example.com/path?q=1&p=2>
```

### accept_query_with_entity

``` md
<https://example.com?p=1&amp;q=2>
```

### accept_href_with_parentheses

``` md
<http://example.com/path_(p)>
```

## email

### accept_mailto_email

``` md
<mailto:user@example.com>
```

### accept_email

``` md
<user@example.com>
```

### accept_email_with_plus

``` md
<user.name+tag@example.co.uk>
```

### accept_email_with_ampersand

``` md
<usr&tag@example.com>
```

### accept_email_with_entity

``` md
<usr&amp;tag@example.com>
```

## position

### accept_before_text

``` md
<https://example.com> Text
```

### accept_before_entity

``` md
<http://example.com>&amp;
```

### accept_after_text

``` md
Text <https://example.com>
```

### accept_after_entity

``` md
&amp;<http://example.com>
```

### accept_consecutive

``` md
<http://doc.example><https://ref.example>
```

## rejection

### reject_irc_scheme

``` md
<irc://example.com>
```

### reject_unknown_scheme

``` md
<bad://example.com>
```

### reject_empty_email_local

``` md
<@example.com>
```

### reject_empty_email_domain

``` md
<user@>
```

### reject_unterminated

``` md
<http://example.com
```

### reject_empty

``` md
<>
```

### reject_leading_space

``` md
< http://example.com>
```

### reject_leading_spaces

``` md
<  http://example.com>
```

### reject_leading_tab

``` md
<	http://example.com>
```

### reject_line_ending_lf

``` md
<http://example.com
>
```

### reject_line_ending_crlf

``` md
<http://example.com
>
```

### reject_line_ending_cr

``` md
<http://example.com
>
```
