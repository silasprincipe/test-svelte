library(duckdb)

con <- dbConnect(duckdb())

dbSendQuery(con, "INSTALL httpfs; LOAD httpfs;")
dbSendQuery(con, "INSTALL h3 FROM community; LOAD h3;")

aggregated_4 <- dbGetQuery(con, 
    "
    SELECT COUNT(species) AS total_species, h3_cell_to_parent(cell, 4) AS cell_4
    FROM read_parquet('s3://obis-products/speciesgrids/h3_7/*')
    GROUP BY cell_4;
    "
)

head(aggregated_4)
colnames(aggregated_4)[2] <- "cell"
aggregated_4$total_species <- as.integer(aggregated_4$total_species)

arrow::write_parquet(aggregated_4, "static/overview_h3_4.parquet")
