CREATE TABLE "turnos" (
	"fecha" text,
	"destino" text,
	"slot_index" integer,
	"hora_plan" text NOT NULL,
	"bus_num" text DEFAULT '' NOT NULL,
	"hora_real" text DEFAULT '' NOT NULL,
	"cancelado" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turnos_pkey" PRIMARY KEY("fecha","destino","slot_index")
);
