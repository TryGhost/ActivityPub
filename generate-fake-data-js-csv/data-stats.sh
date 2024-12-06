#!/usr/bin/env bash

count_lines() {
    if ls $1 >/dev/null 2>&1; then
        printf "%'d" $(cat $1 | wc -l)
    else
        echo "0"
    fi
}

echo "Sites    = $(count_lines './data/sites.csv')"
echo "Accounts = $(count_lines './data/accounts.csv')"
echo "Users    = $(count_lines './data/users.csv')"
echo "Posts    = $(count_lines './data/posts.csv')"
echo "Follows  = $(count_lines './data/follows_*.csv')"
echo "Feeds    = $(count_lines './data/feeds_*.csv')"
