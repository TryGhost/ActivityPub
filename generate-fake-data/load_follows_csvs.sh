#!/bin/bash
set -eu

DATABASE="activitypub"
FOLLOWERS_OR_FOLLOWINGS=$1

docker exec -it scale-testing mysql -uroot -proot $DATABASE -e "SET FOREIGN_KEY_CHECKS=0;"

for file in $(ls output/$FOLLOWERS_OR_FOLLOWINGS*); do
    echo "Importing $file into follows"
    time docker exec -it scale-testing mysql -uroot -proot -e "
    LOAD DATA INFILE '/var/lib/mysql-files/csvs/$file'
    INTO TABLE $DATABASE.follows
    FIELDS TERMINATED BY ',' ENCLOSED BY '\"'
    LINES TERMINATED BY '\n'
    IGNORE 1 ROWS
    (follower_id, following_id);
    "
    echo "Imported $file into follows"
done

docker exec -it scale-testing mysql -uroot -proot $DATABASE -e "SET FOREIGN_KEY_CHECKS=1;"
