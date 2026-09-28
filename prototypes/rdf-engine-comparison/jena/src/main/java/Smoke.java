import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import org.apache.jena.datatypes.xsd.XSDDatatype;
import org.apache.jena.graph.Graph;
import org.apache.jena.graph.Node;
import org.apache.jena.graph.NodeFactory;
import org.apache.jena.query.ARQ;
import org.apache.jena.query.Query;
import org.apache.jena.query.QueryFactory;
import org.apache.jena.rdf.model.InfModel;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.reasoner.ReasonerRegistry;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFParser;
import org.apache.jena.riot.system.ErrorHandlerFactory;
import org.apache.jena.shacl.ShaclValidator;
import org.apache.jena.shacl.Shapes;
import org.apache.jena.shacl.ValidationReport;
import org.apache.jena.sparql.algebra.Algebra;
import org.apache.jena.sparql.algebra.OpVisitorBase;
import org.apache.jena.sparql.algebra.op.OpService;
import org.apache.jena.sparql.algebra.walker.WalkerVisitor;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.DatasetGraphFactory;
import org.apache.jena.sparql.core.DynamicDatasets;
import org.apache.jena.sparql.exec.QueryExec;
import org.apache.jena.sparql.expr.ExprVisitorBase;
import org.apache.jena.sparql.graph.GraphFactory;
import org.apache.jena.sparql.graph.GraphOps;

public class Smoke {
    static final String EX = "https://example.org/";
    static final Node ONTOLOGY = NodeFactory.createURI(EX + "ontology");
    static final Node MODEL = NodeFactory.createURI(EX + "model");
    static final Node DECOY = NodeFactory.createURI(EX + "decoy");
    static final Node SHAPES = NodeFactory.createURI(EX + "shapes");

    static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
        System.out.println("PASS " + label);
    }

    static Graph parse(String file, Lang lang) {
        Graph staged = GraphFactory.createDefaultGraph();
        try {
            RDFParser.source(Path.of("../fixtures", file)).lang(lang)
                    .errorHandler(ErrorHandlerFactory.errorHandlerStrict).parse(staged);
        } catch (org.apache.jena.riot.RiotException error) {
            throw new IllegalArgumentException(file + ": " + error.getMessage(), error);
        }
        return staged;
    }

    static void load(DatasetGraph dataset, String file, Lang lang, Node graph) {
        dataset.addGraph(graph, parse(file, lang)); // Commit only after a complete parse.
    }

    static Query safeQuery(String text) {
        Query query = QueryFactory.create(text);
        if (!(query.isSelectType() || query.isAskType() || query.isConstructType() || query.isDescribeType())
                || query.hasDatasetDescription()) throw new SecurityException("query policy rejected input");
        new WalkerVisitor(new OpVisitorBase() {
            @Override public void visit(OpService service) {
                throw new SecurityException("query policy rejected SERVICE");
            }
        }, new ExprVisitorBase(), null, null).walk(Algebra.compile(query));
        return query;
    }

    static void reject(String text) {
        try {
            safeQuery(text);
            throw new AssertionError("accepted forbidden query: " + text);
        } catch (org.apache.jena.query.QueryParseException | SecurityException expected) {
            // Rejection happens before any executor receives the query.
        }
    }

    static boolean ask(DatasetGraph view, String text) {
        try (QueryExec exec = QueryExec.dataset(view).query(safeQuery(text)).build()) {
            return exec.ask();
        }
    }

    public static void main(String[] args) {
        ARQ.getContext().set(ARQ.httpServiceAllowed, false);
        DatasetGraph dataset = DatasetGraphFactory.createTxnMem();
        load(dataset, "ontology.ttl", Lang.TURTLE, ONTOLOGY);
        load(dataset, "model.nt", Lang.NTRIPLES, MODEL);
        load(dataset, "decoy.ttl", Lang.TURTLE, DECOY);
        load(dataset, "shapes.ttl", Lang.TURTLE, SHAPES);
        check(dataset.getGraph(MODEL).size() == 3, "Turtle and N-Triples loaded as named graphs");

        DatasetGraph view = DynamicDatasets.dynamicDataset(
                List.of(ONTOLOGY, MODEL), List.of(ONTOLOGY, MODEL, DECOY, SHAPES), dataset, false);
        try (QueryExec exec = QueryExec.dataset(view)
                .query(safeQuery("SELECT ?s WHERE { GRAPH <" + MODEL.getURI() + "> { ?s <" + EX + "age> ?age } }"))
                .substitution("age", NodeFactory.createLiteralDT("7", XSDDatatype.XSDinteger)).build()) {
            var rows = exec.select();
            check(rows.hasNext() && rows.next().get("s").getURI().equals(EX + "car1") && !rows.hasNext(),
                    "SELECT, named graph, typed binding");
        }
        try (QueryExec exec = QueryExec.dataset(view)
                .query(safeQuery("ASK { <" + EX + "car1> <" + EX + "age> ?age }"))
                .substitution("age", NodeFactory.createLiteralDT("7", XSDDatatype.XSDinteger)).build()) {
            check(exec.ask(), "ASK uses typed binding in selected default union");
        }
        check(!ask(view, "ASK { <" + EX + "secret> <" + EX + "flag> ?value }"), "default union excludes decoy");
        check(ask(view, "ASK { GRAPH <" + DECOY.getURI() + "> { <" + EX + "secret> <" + EX + "flag> ?value } }"),
                "decoy remains available by graph name");
        try (QueryExec exec = QueryExec.dataset(view).query(safeQuery(
                "CONSTRUCT { ?s <" + EX + "copy> ?age } WHERE { ?s <" + EX + "age> ?age }"))
                .substitution("age", NodeFactory.createLiteralDT("7", XSDDatatype.XSDinteger)).build()) {
            Graph result = exec.construct();
            check(result.size() == 1 && result.find().next().getObject().getLiteralDatatypeURI()
                    .equals(XSDDatatype.XSDinteger.getURI()), "CONSTRUCT uses typed binding and preserves datatype");
        }
        try (QueryExec exec = QueryExec.dataset(view).query(safeQuery(
                "DESCRIBE ?s WHERE { ?s <" + EX + "age> ?age }"))
                .substitution("age", NodeFactory.createLiteralDT("7", XSDDatatype.XSDinteger)).build()) {
            check(exec.describe().size() >= 3, "DESCRIBE uses typed binding and returns local triples");
        }

        reject("INSERT DATA { <" + EX + "s> <" + EX + "p> <" + EX + "o> }");
        reject("LOAD <http://127.0.0.1:1/data>");
        reject("SELECT * WHERE { SERVICE <http://127.0.0.1:1/sparql> { ?s ?p ?o } }");
        reject("SELECT * WHERE { FILTER EXISTS { SERVICE <http://127.0.0.1:1/sparql> { ?s ?p ?o } } }");
        reject("SELECT * WHERE { { SELECT * WHERE { SERVICE <http://127.0.0.1:1/sparql> { ?s ?p ?o } } } }");
        reject("SELECT * FROM <" + DECOY.getURI() + "> WHERE { ?s ?p ?o }");
        reject("SELECT * FROM NAMED <" + DECOY.getURI() + "> WHERE { ?s ?p ?o }");
        check(true, "Update, nested SERVICE, FROM, and FROM NAMED rejected before engine call");

        Graph shapesGraph = dataset.getGraph(SHAPES);
        for (String predicate : List.of("select", "ask")) {
            Node shQuery = NodeFactory.createURI("http://www.w3.org/ns/shacl#" + predicate);
            shapesGraph.find(Node.ANY, shQuery, Node.ANY)
                    .forEachRemaining(t -> safeQuery(t.getObject().getLiteralLexicalForm()));
        }
        reject("SELECT $this WHERE { SERVICE <http://127.0.0.1:1/> { $this ?p ?o } }");
        ValidationReport report = ShaclValidator.get().validate(Shapes.parse(shapesGraph), dataset.getGraph(MODEL));
        var components = report.getEntries().stream().map(e -> e.sourceConstraintComponent().getURI()).toList();
        check(!report.conforms() && components.stream().anyMatch(c -> c.endsWith("MinCountConstraintComponent"))
                && components.stream().anyMatch(c -> c.endsWith("SPARQLConstraintComponent")),
                "SHACL Core and SPARQL violations attributed to shapes graph");
        report.getEntries().forEach(entry -> System.out.println("DIAGNOSTIC shapesGraph=" + SHAPES.getURI()
                + " component=" + entry.sourceConstraintComponent().getURI()));

        int before = dataset.getGraph(DECOY).size();
        try {
            load(dataset, "malformed.ttl", Lang.TURTLE, DECOY);
            throw new AssertionError("malformed file accepted");
        } catch (IllegalArgumentException expected) {
            check(expected.getMessage().contains("malformed.ttl") && dataset.getGraph(DECOY).size() == before,
                    "malformed import names its file and leaves active graph intact");
        }
        check(ask(view, "ASK { GRAPH <" + MODEL.getURI() + "> { <" + EX + "car1> <" + EX + "age> ?age } }"),
                "unrelated graph-specific query still runs");
        check(!ask(view, "ASK { <" + EX + "car1> a <" + EX + "Vehicle> }") &&
                !ask(view, "ASK { <" + EX + "car1> <" + EX + "name> ?name }"),
                "baseline has no implicit subclass or subproperty inference");

        Graph selected = GraphOps.unionGraph(dataset, Set.of(ONTOLOGY, MODEL));
        InfModel inferred = ModelFactory.createInfModel(ReasonerRegistry.getRDFSSimpleReasoner(),
                ModelFactory.createModelForGraph(selected));
        var car = inferred.createResource(EX + "car1");
        check(inferred.contains(car, inferred.createProperty("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
                inferred.createResource(EX + "Vehicle")) &&
                inferred.contains(car, inferred.createProperty(EX + "name"), "Roadster"),
                "optional RDFS simple inference adds superclass and superproperty facts");
    }
}
