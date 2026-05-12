library(duckdb)

con <- dbConnect(duckdb())

dbSendQuery(con, "INSTALL httpfs; LOAD httpfs;")
dbSendQuery(con, "INSTALL h3 FROM community; LOAD h3;")

aggregated_4 <- dbGetQuery(con, 
    "
    SELECT COUNT(DISTINCT species) AS total_species, h3_cell_to_parent(cell, 4) AS cell_4
    FROM read_parquet('s3://obis-products/speciesgrids/h3_7/*')
    GROUP BY cell_4;
    "
)

head(aggregated_4)
colnames(aggregated_4)[2] <- "cell"
aggregated_4$total_species <- as.integer(aggregated_4$total_species)

arrow::write_parquet(aggregated_4, "static/overview_h3_4.parquet")


aggregated_3 <- dbGetQuery(con, 
    "
    SELECT COUNT(DISTINCT species) AS total_species, h3_cell_to_parent(cell, 3) AS cell_3
    FROM read_parquet('s3://obis-products/speciesgrids/h3_7/*')
    GROUP BY cell_3;
    "
)

head(aggregated_3)
colnames(aggregated_3)[2] <- "cell"
aggregated_3$total_species <- as.integer(aggregated_3$total_species)

arrow::write_parquet(aggregated_3, "static/overview_h3_3.parquet")

species_list <- dbGetQuery(con, 
    "
    SELECT DISTINCT species
    FROM read_parquet('s3://obis-products/speciesgrids/h3_7/*');
    "
)

#arrow::write_parquet(species_list, "static/species_list.parquet")

jsonlite::write_json(list(species = species_list$species), "static/species_list.json", pretty = TRUE, simplifyVector = T)
